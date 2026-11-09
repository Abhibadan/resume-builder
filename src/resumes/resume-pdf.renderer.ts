import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Resume } from './resume.schema.js';

export class PdfRendererBusy extends Error {}
export class PdfRenderTimeout extends Error {}

const maxConcurrentRenders = 2;
const renderTimeoutMs = 15_000;

@Injectable()
export class ResumePdfRenderer implements OnModuleDestroy {
    private browserPromise?: Promise<Browser>;
    private activeRenders = 0;
    private isClosing = false;

    render(html: string, output: Resume['rendering']['output']): Promise<Buffer> {
        return this.withPage(async (page) => {
            await page.setContent(html, { timeout: renderTimeoutMs, waitUntil: 'load' });
            return this.print(page, output);
        });
    }

    print(page: Page, output: Resume['rendering']['output']): Promise<Buffer> {
        return page.pdf({
            format: 'A4',
            printBackground: output.printBackground,
            preferCSSPageSize: output.preferCssPageSize,
            tagged: output.tagged,
            displayHeaderFooter: false,
            scale: 1,
        });
    }

    async withPage<T>(operation: (page: Page) => Promise<T>): Promise<T> {
        if (this.isClosing || this.activeRenders >= maxConcurrentRenders) {
            throw new PdfRendererBusy();
        }

        this.activeRenders++;
        let context: BrowserContext | undefined;
        let hasTimedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                hasTimedOut = true;
                reject(new PdfRenderTimeout());
                void context?.close().catch(() => undefined);
            }, renderTimeoutMs);
        });

        const render = async (): Promise<T> => {
            try {
                const browser = await this.getBrowser();
                if (hasTimedOut) throw new PdfRenderTimeout();
                context = await browser.newContext({
                    javaScriptEnabled: false,
                    serviceWorkers: 'block',
                });
                if (hasTimedOut) throw new PdfRenderTimeout();

                await context.route('**/*', (route) => route.abort());
                const page = await context.newPage();
                return await operation(page);
            } finally {
                try {
                    await context?.close().catch(() => undefined);
                } finally {
                    this.activeRenders--;
                }
            }
        };

        try {
            return await Promise.race([render(), deadline]);
        } finally {
            clearTimeout(timer);
        }
    }

    async onModuleDestroy(): Promise<void> {
        this.isClosing = true;
        const browser = await this.browserPromise?.catch(() => undefined);
        await browser?.close();
    }

    private getBrowser(): Promise<Browser> {
        this.browserPromise ??= chromium
            .launch({
                executablePath: process.env.RESUME_CHROMIUM_EXECUTABLE_PATH,
                chromiumSandbox: true,
                timeout: 10_000,
            })
            .then((browser) => {
                browser.once('disconnected', () => {
                    this.browserPromise = undefined;
                });
                return browser;
            })
            .catch((error: unknown) => {
                this.browserPromise = undefined;
                throw error;
            });

        return this.browserPromise;
    }
}
