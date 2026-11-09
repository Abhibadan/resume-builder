const root = document.querySelector('#fields');
const preview = document.querySelector('#preview');
const fit = document.querySelector('#fit');
const status = document.querySelector('#status');
const pdfButton = document.querySelector('#download-pdf');
const printButton = document.querySelector('#print');

const sectionLabels = {
    summary: 'Professional summary',
    skill_groups: 'Skills',
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
    certifications: 'Certifications',
    bullet_list: 'Awards and achievements',
};

const itemFields = {
    skill_groups: [
        ['label', 'Group label'],
        ['values', 'Skills, one per line', 'lines'],
    ],
    experience: [
        ['role', 'Role'],
        ['organization', 'Organization'],
        ['location', 'Location'],
        ['dateDisplay', 'Dates as shown on resume'],
        ['bullets', 'Highlights, one per line', 'lines'],
    ],
    projects: [
        ['name', 'Project name'],
        ['dateDisplay', 'Dates as shown on resume'],
        ['technologies', 'Tools, one per line', 'lines'],
        ['bullets', 'Highlights, one per line', 'lines'],
    ],
    education: [
        ['qualification', 'Qualification'],
        ['institution', 'Institution'],
        ['location', 'Location'],
        ['dateDisplay', 'Dates as shown on resume'],
    ],
    certifications: [
        ['name', 'Certification name'],
        ['issuer', 'Issuer'],
        ['durationDisplay', 'Duration'],
        ['dateDisplay', 'Date (e.g. Jan 2026)'],
        ['url', 'Certificate URL', 'url'],
    ],
};

const initialSections = Object.entries(sectionLabels).map(([type, title]) => ({
    type,
    title,
    id: type,
    visible: true,
    ...(type === 'summary' ? { content: '' } : { items: [] }),
}));

let resume = {
    schemaVersion: '1.0.0',
    document: { type: 'resume', language: 'en', pageSize: 'A4', contentVariant: 'student-fresher' },
    profile: { fullName: '', contact: { links: [] } },
    sections: initialSections,
};
let template = { id: 'classic-ats', version: 1 };
let layout = {};
let templates = [];
let previewUrl;
let timer;
let revision = 0;
let inFlight = false;

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function button(label, action) {
    const element = node('button', label);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
}

function field(label, value, change, type = 'text') {
    const wrapper = node('label', label, type === 'checkbox' ? 'check' : undefined);
    const input = node(['lines', 'textarea'].includes(type) ? 'textarea' : 'input');
    if (input instanceof HTMLInputElement) input.type = type;
    if (type === 'checkbox') input.checked = value;
    else if (type === 'lines') input.value = (value ?? []).join('\n');
    else input.value = value ?? '';
    input.addEventListener('input', () => {
        let next = input.value;
        if (type === 'checkbox') next = input.checked;
        if (type === 'number') next = next === '' ? undefined : Number(next);
        if (type === 'lines')
            next = next
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
        change(next);
        queuePreview();
    });
    wrapper.append(input);
    return wrapper;
}

function property(object, key, label, type, fallback) {
    return field(
        label,
        object[key] ?? fallback,
        (value) => {
            if (value === '' || value === undefined) delete object[key];
            else object[key] = value;
        },
        type,
    );
}

function select(label, choices, value, change) {
    const wrapper = node('label', label);
    const input = node('select');
    for (const [id, name] of choices) {
        const option = node('option', name);
        option.value = id;
        input.append(option);
    }
    input.value = value;
    input.addEventListener('change', () => {
        change(input.value);
        queuePreview();
    });
    wrapper.append(input);
    return wrapper;
}

function group(title) {
    const element = node('fieldset');
    element.append(node('legend', title));
    return element;
}

function grid(...children) {
    const element = node('div', undefined, 'grid');
    element.append(...children);
    return element;
}

function redraw(action) {
    return () => {
        action();
        renderEditor();
        queuePreview();
    };
}

function linksEditor(owner, contact) {
    owner.links ??= [];
    const heading = contact ? 'Contact links' : 'Project links';
    const box = node('div');
    box.append(node('h3', heading));
    owner.links.forEach((link, index) => {
        const row = node('div', undefined, 'entry');
        row.append(grid(property(link, 'label', 'Link label'), property(link, 'url', 'Link URL', 'url')));
        if (contact) row.append(property(link, 'visible', 'Show link', 'checkbox', true));
        row.append(
            button(
                'Remove link',
                redraw(() => owner.links.splice(index, 1)),
            ),
        );
        box.append(row);
    });
    const actions = node('div', undefined, 'actions');
    if (contact) {
        for (const [type, label] of [
            ['linkedin', 'LinkedIn'],
            ['github', 'GitHub'],
            ['portfolio', 'Portfolio'],
        ]) {
            if (owner.links.some((link) => link.type === type)) continue;
            actions.append(
                button(
                    `Add ${label}`,
                    redraw(() => owner.links.push({ label, type, url: '' })),
                ),
            );
        }
    }
    actions.append(
        button(
            contact ? 'Add contact link' : 'Add project link',
            redraw(() => owner.links.push({ label: '', url: '' })),
        ),
    );
    box.append(actions);
    return box;
}

function profileEditor() {
    const box = group('Profile and contact');
    const { profile } = resume;
    profile.contact ??= {};
    const { contact } = profile;
    box.append(
        grid(
            property(profile, 'fullName', 'Full name'),
            property(profile, 'headline', 'Headline'),
            property(contact, 'email', 'Email', 'email'),
            property(contact, 'phone', 'Phone', 'tel'),
            field('Location', contact.location?.display, (value) => {
                if (value.trim()) contact.location = { ...contact.location, display: value };
                else delete contact.location;
            }),
        ),
        linksEditor(contact, true),
    );
    return box;
}

function layoutEditor() {
    const box = group('Resume settings');
    const selected = `${template.id}@${template.version}`;
    const choices = templates.map(({ id, name, version }) => [`${id}@${version}`, `${name} · v${version}`]);
    if (!choices.some(([key]) => key === selected)) choices.push([selected, `${template.id} · v${template.version}`]);
    box.append(
        grid(
            select('Template preset', choices, selected, (key) => {
                const [id, version] = key.split('@');
                template = { id, version: Number(version) };
            }),
            select(
                'Resume type',
                [
                    ['', 'General resume'],
                    ['student-fresher', 'Student / recent graduate'],
                    ['experienced-professional', 'Experienced professional'],
                ],
                resume.document?.contentVariant ?? '',
                (contentVariant) => {
                    resume.document = {
                        type: 'resume',
                        language: 'en',
                        pageSize: 'A4',
                        ...resume.document,
                    };
                    if (contentVariant) resume.document.contentVariant = contentVariant;
                    else delete resume.document.contentVariant;
                },
            ),
            property(layout, 'maxPages', 'Maximum pages (blank uses preset)', 'number'),
            select(
                'Education exclusion',
                [
                    ['default', 'Use preset'],
                    ['false', 'Keep education'],
                    ['true', 'Allow education exclusion'],
                ],
                String(layout.allowEducationExclusion ?? 'default'),
                (value) => {
                    if (value === 'default') delete layout.allowEducationExclusion;
                    else layout.allowEducationExclusion = value === 'true';
                },
            ),
        ),
    );
    const appearance = node('details');
    appearance.append(node('summary', 'Appearance'));
    const rendering = (resume.rendering ??= {});
    const colors = (rendering.colors ??= {});
    const spacing = (rendering.layout ??= {});
    appearance.append(
        grid(
            property(colors, 'primary', 'Accent color', 'color', '#1F3A68'),
            property(colors, 'body', 'Text color', 'color', '#202020'),
            property(spacing, 'compactSpacing', 'Compact spacing', 'checkbox', true),
        ),
    );
    box.append(appearance);
    return box;
}

function sectionEditor(section, sectionIndex) {
    const box = group(sectionLabels[section.type]);
    const controls = grid(
        property(section, 'title', 'Section heading'),
        property(section, 'visible', 'Show section', 'checkbox', true),
    );
    if (section.type === 'skill_groups') {
        controls.append(
            select(
                'Skills style',
                [
                    ['grouped', 'Grouped rows'],
                    ['bullets', 'Simple bullets'],
                ],
                section.style ?? 'grouped',
                (style) => {
                    section.style = style;
                },
            ),
        );
    }
    box.append(controls);
    const rules = node('details');
    rules.append(node('summary', 'Fit settings'));
    const rule = ((layout.sections ??= {})[section.type] ??= {});
    const settings = grid(
        property(rule, 'priority', 'Priority 0–100 (blank uses preset)', 'number'),
        select(
            'Protect section',
            [
                ['default', 'Use preset'],
                ['true', 'Keep all content'],
                ['false', 'Allow reduction'],
            ],
            String(rule.protected ?? 'default'),
            (value) => {
                if (value === 'default') delete rule.protected;
                else rule.protected = value === 'true';
            },
        ),
    );
    if (section.type !== 'summary')
        settings.append(property(rule, 'maxItems', 'Item limit (blank uses preset)', 'number'));
    rules.append(settings);
    box.append(rules);

    if (section.type === 'summary') box.append(property(section, 'content', 'Summary', 'textarea'));
    else {
        section.items.forEach((item, index) => box.append(itemEditor(section, item, index)));
        box.append(
            button(
                'Add entry',
                redraw(() => {
                    const required = itemFields[section.type]?.[0]?.[0];
                    section.items.push(section.type === 'bullet_list' ? '' : { [required]: '' });
                    if (section.type === 'skill_groups') section.items.at(-1).values = [];
                }),
            ),
        );
    }
    const actions = node('div', undefined, 'actions');
    actions.append(
        button(
            'Remove section',
            redraw(() => resume.sections.splice(sectionIndex, 1)),
        ),
    );
    box.append(actions);
    return box;
}

function itemEditor(section, item, index) {
    const box = node('article', undefined, 'entry');
    const heading = node('div', undefined, 'row-heading');
    heading.append(
        node('h3', `Entry ${index + 1}`),
        button(
            'Remove entry',
            redraw(() => {
                section.items.splice(index, 1);
                section.protectedItemIndexes = (section.protectedItemIndexes ?? [])
                    .filter((protectedIndex) => protectedIndex !== index)
                    .map((protectedIndex) => (protectedIndex > index ? protectedIndex - 1 : protectedIndex));
            }),
        ),
    );
    box.append(heading);
    if (section.type === 'bullet_list')
        box.append(
            field(
                'Achievement',
                item,
                (value) => {
                    section.items[index] = value;
                },
                'textarea',
            ),
        );
    else box.append(grid(...itemFields[section.type].map(([key, label, type]) => property(item, key, label, type))));
    box.append(
        field(
            'Protect entry from reduction',
            section.protectedItemIndexes?.includes(index) ?? false,
            (isProtected) => {
                const indexes = new Set(section.protectedItemIndexes);
                if (isProtected) indexes.add(index);
                else indexes.delete(index);
                section.protectedItemIndexes = [...indexes].sort((a, b) => a - b);
            },
            'checkbox',
        ),
    );

    if (section.type === 'projects') box.append(linksEditor(item, false));
    if (section.type === 'education') {
        if (item.score)
            box.append(
                grid(
                    property(item.score, 'label', 'Score label'),
                    property(item.score, 'value', 'Score value'),
                    property(item.score, 'visible', 'Show score', 'checkbox', true),
                ),
                button(
                    'Remove score',
                    redraw(() => {
                        delete item.score;
                    }),
                ),
            );
        else
            box.append(
                button(
                    'Add score',
                    redraw(() => {
                        item.score = { label: 'CGPA', value: '' };
                    }),
                ),
            );
    }
    if (section.type === 'certifications' && item.year && !item.dateDisplay) {
        box.append(node('p', `Imported year: ${item.year}. Add a month and year above to replace it in the PDF.`));
    }
    return box;
}

function renderEditor() {
    const add = group('Add a section');
    let nextType = 'summary';
    add.append(
        grid(
            select('Section type', Object.entries(sectionLabels), nextType, (value) => {
                nextType = value;
            }),
            button(
                'Add section',
                redraw(() => {
                    let suffix = 1;
                    while (resume.sections.some(({ id }) => id === `${nextType}-${suffix}`)) suffix++;
                    resume.sections.push({
                        type: nextType,
                        id: `${nextType}-${suffix}`,
                        title: sectionLabels[nextType],
                        visible: true,
                        ...(nextType === 'summary' ? { content: '' } : { items: [] }),
                    });
                }),
            ),
        ),
    );
    root.replaceChildren(profileEditor(), layoutEditor(), ...resume.sections.map(sectionEditor), add);
}

function payload() {
    return {
        resume: {
            ...resume,
            sections: resume.sections.filter((section) =>
                section.type === 'summary' ? section.content?.trim() : section.items.length > 0,
            ),
        },
        template,
        layout,
    };
}

async function api(path, data) {
    const response = await fetch(
        `/resumes/${path}`,
        data === undefined
            ? {}
            : {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
              },
    );
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const details = error.issues?.map(({ path, message }) => `${path}: ${message}`).join(' · ');
        throw new Error(details || error.message || `Request failed (${response.status})`);
    }
    return response;
}

function setBadge(label, state) {
    fit.textContent = label;
    fit.dataset.state = state;
}

function queuePreview() {
    revision++;
    clearTimeout(timer);
    pdfButton.disabled = true;
    printButton.disabled = true;
    document.querySelector('#report').hidden = true;
    if (!resume.profile.fullName?.trim()) {
        setBadge('Waiting for details', '');
        status.textContent = 'Enter your name to start the preview.';
        preview.hidden = true;
        document.querySelector('#placeholder').hidden = false;
        return;
    }
    setBadge('Updating…', '');
    status.textContent = 'Checking content and page fit.';
    timer = setTimeout(updatePreview, 450);
}

async function updatePreview() {
    if (inFlight) return;
    inFlight = true;
    const current = revision;
    try {
        const response = await api('preview', payload());
        const { pdf, report } = await response.json();
        if (revision !== current) return;
        const bytes = Uint8Array.from(atob(pdf), (character) => character.charCodeAt(0));
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        preview.src = `${previewUrl}#toolbar=0&navpanes=0&view=FitH`;
        preview.hidden = false;
        document.querySelector('#placeholder').hidden = true;
        showReport(report);
    } catch (error) {
        if (revision === current) {
            status.textContent = error.message;
            setBadge('Needs attention', 'overflow');
        }
    } finally {
        inFlight = false;
        if (revision !== current && resume.profile.fullName?.trim()) {
            clearTimeout(timer);
            timer = setTimeout(updatePreview, 450);
        }
    }
}

function showReport(report) {
    setBadge(`${report.pageCount} / ${report.maxPages} pages`, report.fits ? 'fit' : 'overflow');
    status.textContent = report.fits
        ? 'Fits the selected page limit.'
        : 'Review the warnings before downloading a PDF.';
    pdfButton.disabled = !report.fits;
    printButton.disabled = !report.fits;
    const reportBox = document.querySelector('#report');
    reportBox.hidden = !report.warnings.length && !report.exclusions.length;
    document.querySelector('#warnings').replaceChildren(...report.warnings.map((warning) => node('li', warning)));
    document.querySelector('#exclusions').hidden = report.exclusions.length === 0;
    document.querySelector('#exclusion-title').textContent = `Excluded content (${report.exclusions.length})`;
    document
        .querySelector('#excluded-items')
        .replaceChildren(
            ...report.exclusions.map((entry) =>
                node(
                    'li',
                    `${entry.sectionTitle}: ${entry.label} (${entry.reason === 'limit' ? 'item limit' : 'page fit'})`,
                ),
            ),
        );
}

function download(url, filename) {
    const link = node('a');
    link.href = url;
    link.download = filename;
    link.click();
}

pdfButton.addEventListener('click', () => download(previewUrl, 'resume.pdf'));
printButton.addEventListener('click', () => window.open(previewUrl, '_blank', 'noopener'));
document.querySelector('#download-json').addEventListener('click', async () => {
    try {
        const response = await api('export/json', payload());
        const url = URL.createObjectURL(await response.blob());
        download(url, 'resume.json');
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        status.textContent = error.message;
    }
});
document.querySelector('#import').addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
        if (file.size > 512 * 1024) throw new Error('Choose a JSON file smaller than 512 KiB.');
        const parsed = JSON.parse(await file.text());
        const response = await api('export/json', parsed?.resume ? parsed : { resume: parsed });
        ({ resume, template, layout = {} } = await response.json());
        renderEditor();
        queuePreview();
    } catch (error) {
        status.textContent = error.message;
    } finally {
        input.value = '';
    }
});

renderEditor();
api('templates')
    .then((response) => response.json())
    .then((items) => {
        templates = items;
        renderEditor();
    })
    .catch((error) => {
        status.textContent = error.message;
    });
