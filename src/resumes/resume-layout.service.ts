import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import type { Page } from 'playwright';
import { ClassicAtsTemplate } from './classic-ats.template.js';
import { ResumePdfRenderer } from './resume-pdf.renderer.js';
import type { Resume, ResumeSection } from './resume.schema.js';
import type { LayoutOverrides } from './templates/template.schema.js';
import type { TemplateRevision } from './templates/template.service.js';

interface Removal {
    sectionIndex: number;
    itemIndex?: number;
    label: string;
    reason: 'limit' | 'page-fit';
}

export interface LayoutReport {
    template: { id: string; version: number };
    isStudent: boolean;
    fits: boolean;
    maxPages: number;
    initialPageCount: number;
    pageCount: number;
    contentHeightMm: number;
    horizontalOverflow: boolean;
    exclusions: {
        sectionId: string;
        sectionTitle: string;
        itemIndex?: number;
        label: string;
        reason: 'limit' | 'page-fit';
    }[];
    warnings: string[];
}

export interface ResumeLayout {
    pdf: Buffer;
    report: LayoutReport;
}

interface Measurement {
    pdf: Buffer;
    pageCount: number;
    contentHeightMm: number;
    horizontalOverflow: boolean;
}

@Injectable()
export class ResumeLayoutService {
    constructor(
        private readonly template: ClassicAtsTemplate,
        private readonly renderer: ResumePdfRenderer,
    ) {}

    fit(resume: Resume, revision: TemplateRevision, options?: LayoutOverrides): Promise<ResumeLayout> {
        const { config, id, version } = revision;
        const isStudent = resume.document?.contentVariant === 'student-fresher';
        const overrides = isStudent ? config.studentOverrides : undefined;
        const maxPages = options?.maxPages ?? overrides?.maxPages ?? config.maxPages;
        const allowEducationExclusion =
            options?.allowEducationExclusion ?? overrides?.allowEducationExclusion ?? config.allowEducationExclusion;
        const limits: Removal[] = [];
        const candidates: (Removal & { priority: number })[] = [];
        const warnings: string[] = [];

        resume.sections.forEach((section, sectionIndex) => {
            if (!section.visible) return;
            const rule = {
                ...config.sections[section.type],
                ...overrides?.sections?.[section.type],
                ...options?.sections?.[section.type],
            };
            const isProtected = rule.protected || (section.type === 'education' && !allowEducationExclusion);
            const priority = rule.priority ?? 50;
            if (section.type === 'summary') {
                if (!isProtected) candidates.push({ sectionIndex, priority, label: section.title, reason: 'page-fit' });
                return;
            }

            const protectedItems = new Set(section.protectedItemIndexes);
            const maxItems = rule.maxItems ?? section.items.length;
            let remaining = section.items.length;
            for (let itemIndex = remaining - 1; itemIndex >= 0; itemIndex--) {
                if (isProtected || protectedItems.has(itemIndex)) continue;
                const removal = { sectionIndex, itemIndex, label: this.itemLabel(section.items[itemIndex]) };
                if (remaining > maxItems) {
                    limits.push({ ...removal, reason: 'limit' });
                    remaining--;
                } else {
                    candidates.push({ ...removal, priority, reason: 'page-fit' });
                }
            }
            if (remaining > maxItems)
                warnings.push(`${section.title} exceeds its item limit because it contains protected content.`);
            if (!isProtected && section.items.length === 0) {
                candidates.push({ sectionIndex, priority, label: section.title, reason: 'page-fit' });
            }
        });

        candidates.sort((a, b) => a.priority - b.priority || b.sectionIndex - a.sectionIndex);

        return this.renderer.withPage(async (page) => {
            const { left, right, top, bottom } = resume.rendering.page.marginMm;
            await page.setViewportSize({
                width: Math.ceil(((210 - left - right) * 96) / 25.4),
                height: Math.ceil(((297 - top - bottom) * 96) / 25.4),
            });
            await page.emulateMedia({ media: 'print' });

            const measure = (count: number) =>
                this.measure(page, this.applyRemovals(resume, [...limits, ...candidates.slice(0, count)]));
            const fits = (measurement: Measurement) =>
                measurement.pageCount <= maxPages && !measurement.horizontalOverflow;
            const initial = await measure(0);
            let final = initial;
            let count = 0;
            if (!fits(initial) && candidates.length > 0) {
                let lower = 0;
                let upper = candidates.length;
                final = await measure(upper);
                if (fits(final)) {
                    while (upper - lower > 1) {
                        const middle = Math.floor((lower + upper) / 2);
                        const measurement = await measure(middle);
                        if (fits(measurement)) {
                            upper = middle;
                            final = measurement;
                        } else {
                            lower = middle;
                        }
                    }
                }
                count = upper;
            }

            if (final.pageCount > maxPages)
                warnings.push(`The remaining content uses ${final.pageCount} pages. The template allows ${maxPages}.`);
            if (final.horizontalOverflow) warnings.push('The remaining content extends beyond the printable width.');
            return {
                pdf: final.pdf,
                report: {
                    template: { id, version },
                    isStudent,
                    fits: fits(final),
                    maxPages,
                    initialPageCount: initial.pageCount,
                    pageCount: final.pageCount,
                    contentHeightMm: final.contentHeightMm,
                    horizontalOverflow: final.horizontalOverflow,
                    exclusions: [...limits, ...candidates.slice(0, count)].map(
                        ({ sectionIndex, itemIndex, label, reason }) => ({
                            sectionId: resume.sections[sectionIndex].id,
                            sectionTitle: resume.sections[sectionIndex].title,
                            itemIndex,
                            label,
                            reason,
                        }),
                    ),
                    warnings,
                },
            };
        });
    }

    private async measure(page: Page, resume: Resume): Promise<Measurement> {
        await page.setContent(this.template.render(resume), { waitUntil: 'load', timeout: 10_000 });
        const bounds = await page.evaluate(async () => {
            await document.fonts.ready;
            return {
                height: document.body.getBoundingClientRect().height,
                horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
            };
        });
        const pdf = await this.renderer.print(page, resume.rendering.output);
        return {
            pdf,
            pageCount: (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount(),
            contentHeightMm: Math.round(((bounds.height * 25.4) / 96) * 10) / 10,
            horizontalOverflow: bounds.horizontalOverflow,
        };
    }

    private applyRemovals(resume: Resume, removals: Removal[]): Resume {
        const result = structuredClone(resume);
        const bySection = new Map<number, Removal[]>();
        for (const removal of removals) {
            const group = bySection.get(removal.sectionIndex) ?? [];
            group.push(removal);
            bySection.set(removal.sectionIndex, group);
        }
        for (const [sectionIndex, group] of bySection) {
            const section = result.sections[sectionIndex];
            if (section.type === 'summary' || group.some((entry) => entry.itemIndex === undefined)) {
                section.visible = false;
                continue;
            }
            const indexes = group
                .flatMap(({ itemIndex }) => (itemIndex === undefined ? [] : [itemIndex]))
                .sort((a, b) => b - a);
            for (const index of indexes) section.items.splice(index, 1);
            if (section.items.length === 0) section.visible = false;
        }
        return result;
    }

    private itemLabel(item: Exclude<ResumeSection, { type: 'summary' }>['items'][number]): string {
        if (typeof item === 'string') return item.length > 120 ? `${item.slice(0, 117)}…` : item;
        if ('role' in item) return item.role;
        if ('qualification' in item) return item.qualification;
        if ('name' in item) return item.name;
        return item.label;
    }
}
