const root = document.querySelector('#fields');
const sectionNav = document.querySelector('#section-nav');
const preview = document.querySelector('#preview');
const fit = document.querySelector('#fit');
const status = document.querySelector('#status');
const warning = document.querySelector('#validation-warning');
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
let activePanel = 'profile';
const fieldControls = new WeakMap();

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function button(label, action, className = 'ui-button') {
    const element = node('button', label, className);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
}

function field(label, value, change, type = 'text') {
    const wrapper = node('label', label, type === 'checkbox' ? 'form-check' : 'form-field');
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
    const wrapper = field(
        label,
        object[key] ?? fallback,
        (value) => {
            if (value === '' || value === undefined) delete object[key];
            else object[key] = value;
        },
        type,
    );
    if (!fieldControls.has(object)) fieldControls.set(object, new Map());
    fieldControls.get(object).set(key, { label, input: wrapper.lastElementChild });
    return wrapper;
}

function select(label, choices, value, change) {
    const wrapper = node('label', label, 'form-field');
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

function numberSetting(object, key, label, fallback, min, max, step) {
    const wrapper = property(object, key, label, 'number', fallback);
    Object.assign(wrapper.lastElementChild, { min, max, step });
    return wrapper;
}

function group(title) {
    const element = node('fieldset', undefined, 'editor-panel');
    element.append(node('legend', title));
    return element;
}

function grid(...children) {
    const element = node('div', undefined, 'form-grid');
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
    const box = node('div', undefined, 'space-y-2 border-t border-slate-200 pt-3');
    box.append(node('h3', heading, 'text-xs font-semibold text-slate-800'));
    owner.links.forEach((link, index) => {
        const row = node('div', undefined, 'form-entry');
        row.append(grid(property(link, 'label', 'Link label'), property(link, 'url', 'Link URL', 'url')));
        const actions = node('div', undefined, 'flex flex-wrap items-center justify-between gap-1.5');
        if (contact) actions.append(property(link, 'visible', 'Show link', 'checkbox', true));
        actions.append(
            button(
                'Remove link',
                redraw(() => owner.links.splice(index, 1)),
                'ui-button ui-button-quiet ml-auto',
            ),
        );
        row.append(actions);
        box.append(row);
    });
    const actions = node('div', undefined, 'flex flex-wrap items-center gap-1.5');
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
    const appearance = node('details', undefined, 'form-details');
    appearance.append(node('summary', 'Appearance'));
    const rendering = (resume.rendering ??= {});
    const colors = (rendering.colors ??= {});
    const spacing = (rendering.layout ??= {});
    appearance.append(
        grid(
            property(colors, 'primary', 'Accent color', 'color', '#1F3A68'),
            property(colors, 'body', 'Text color', 'color', '#202020'),
            numberSetting(spacing, 'bodyFontSizePt', 'Body font size (pt)', 9.2, 8, 12, 0.1),
            numberSetting(spacing, 'lineHeight', 'Line spacing (×)', 1.13, 1.05, 1.6, 0.01),
            numberSetting(spacing, 'letterSpacingPt', 'Letter spacing (pt)', 0, -0.2, 0.8, 0.05),
            property(spacing, 'compactSpacing', 'Compact spacing', 'checkbox', true),
        ),
    );
    box.append(appearance);
    return box;
}

function sectionEditor(section, sectionIndex) {
    const box = group(sectionLabels[section.type]);
    if (section.type === 'projects') {
        box.append(node('p', 'At least one project must be visible.', 'text-sm text-slate-600'));
    }
    const controls = grid(
        property(section, 'title', 'Section heading'),
        property(section, 'visible', 'Show section', 'checkbox', true),
    );
    if (section.type === 'skill_groups') {
        box.classList.add('group/skills');
        box.dataset.skillsStyle = section.style ?? 'grouped';
        const columns = select(
            'Bullet columns',
            [
                ['2', '2 columns'],
                ['3', '3 columns'],
                ['4', '4 columns'],
            ],
            String(section.columns ?? 3),
            (value) => {
                section.columns = Number(value);
            },
        );
        columns.hidden = section.style !== 'bullets';
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
                    box.dataset.skillsStyle = style;
                    columns.hidden = style !== 'bullets';
                },
            ),
            columns,
        );
    }
    box.append(controls);
    const rules = node('details', undefined, 'form-details');
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
        const addEntry = button(
            'Add entry',
            redraw(() => {
                if (section.type === 'bullet_list') section.items.push('');
                else if (section.type === 'skill_groups') section.items.push({ values: [] });
                else section.items.push({ [itemFields[section.type][0][0]]: '' });
            }),
        );
        fieldControls.get(section).set('addEntry', { input: addEntry });
        box.append(addEntry);
    }
    const actions = node('div', undefined, 'flex flex-wrap items-center gap-1.5');
    actions.append(
        button(
            'Remove section',
            redraw(() => resume.sections.splice(sectionIndex, 1)),
            'ui-button ui-button-quiet',
        ),
    );
    box.append(actions);
    return box;
}

function itemEditor(section, item, index) {
    const box = node('article', undefined, 'form-entry');
    const heading = node('div', undefined, 'flex flex-wrap items-center justify-between gap-1.5');
    heading.append(
        node('h3', `Entry ${index + 1}`, 'text-xs font-semibold text-slate-800'),
        button(
            'Remove entry',
            redraw(() => {
                section.items.splice(index, 1);
                section.protectedItemIndexes = (section.protectedItemIndexes ?? [])
                    .filter((protectedIndex) => protectedIndex !== index)
                    .map((protectedIndex) => (protectedIndex > index ? protectedIndex - 1 : protectedIndex));
            }),
            'ui-button ui-button-quiet',
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
    else {
        const fields = itemFields[section.type].map(([key, label, type]) => property(item, key, label, type));
        if (section.type === 'skill_groups') {
            fields[0].classList.add('group-data-[skills-style=bullets]/skills:hidden');
            fields[1].classList.add('group-data-[skills-style=bullets]/skills:col-span-full');
        }
        box.append(grid(...fields));
    }
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
                    const section = {
                        type: nextType,
                        id: `${nextType}-${suffix}`,
                        title: sectionLabels[nextType],
                        visible: true,
                        ...(nextType === 'summary' ? { content: '' } : { items: [] }),
                    };
                    resume.sections.push(section);
                    activePanel = section;
                }),
            ),
        ),
    );
    const sectionCounts = new Map();
    const panels = [
        { key: 'profile', label: 'Profile & contact', content: profileEditor() },
        ...resume.sections.map((section, index) => {
            const count = (sectionCounts.get(section.type) ?? 0) + 1;
            sectionCounts.set(section.type, count);
            const label =
                { summary: 'Summary', bullet_list: 'Achievements' }[section.type] ?? sectionLabels[section.type];
            return {
                key: section,
                label: count === 1 ? label : `${label} ${count}`,
                content: sectionEditor(section, index),
            };
        }),
        { key: 'settings', label: 'Resume settings', content: layoutEditor() },
        { key: 'add', label: '+ Add section', content: add },
    ];
    if (!panels.some(({ key }) => key === activePanel)) activePanel = 'profile';

    for (const [index, panel] of panels.entries()) {
        panel.content.id = `editor-panel-${index}`;
        panel.control = button(
            panel.label,
            () => {
                activePanel = panel.key;
                updateSelection();
            },
            'editor-nav-button',
        );
        panel.control.setAttribute('aria-controls', panel.content.id);
    }

    function updateSelection() {
        for (const panel of panels) {
            const selected = panel.key === activePanel;
            panel.content.hidden = !selected;
            panel.control.setAttribute('aria-pressed', String(selected));
        }
    }

    updateSelection();
    const scrollPosition = sectionNav.scrollLeft;
    sectionNav.replaceChildren(...panels.map(({ control }) => control));
    sectionNav.scrollLeft = scrollPosition;
    root.replaceChildren(...panels.map(({ content }) => content));
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
        throw Object.assign(new Error(error.message || `Request failed (${response.status})`), {
            issues: error.issues,
        });
    }
    return response;
}

function setBadge(label, state) {
    fit.textContent = label;
    fit.dataset.state = state;
}

function describeIssue(path, data) {
    if (path === 'resume.sections.projects') {
        const projects = data && resume.sections.filter((section) => section.type === 'projects');
        const hidden = projects?.find((section) => section.visible === false && section.items.length);
        const section = hidden ?? projects?.[0];
        const input = fieldControls.get(section)?.get(hidden ? 'visible' : 'addEntry')?.input;
        return { label: 'Projects', input: input?.disabled ? undefined : input };
    }
    const keys = path.split('.');
    const section = keys[1] === 'sections' ? data?.resume.sections[keys[2]] : undefined;
    let owner = data;
    let control;
    for (const key of keys) {
        control = fieldControls.get(owner)?.get(key) ?? control;
        owner = owner?.[key];
    }
    const fieldName =
        control?.label.replace(/ \(e\.g\. .*\)$/, '') ??
        keys
            .filter((key) => /[a-z]/i.test(key))
            .at(-1)
            ?.replace(/([a-z])([A-Z])/g, '$1 $2');
    const entry = keys[3] === 'items' && /^\d+$/.test(keys[4]) ? `Entry ${Number(keys[4]) + 1}` : '';
    return {
        input: control?.input,
        label: [section && sectionLabels[section.type], entry, fieldName].filter(Boolean).join(' / '),
    };
}

function showWarning(error, data, isPreview = false) {
    const issues = error.issues ?? [];
    document.querySelector('#warning-title').textContent = issues.length
        ? issues.length === 1
            ? 'Fix 1 field'
            : `Fix ${issues.length} fields`
        : error.message;
    const note = document.querySelector('#warning-note');
    note.textContent = preview.hidden
        ? 'Update the fields below to continue.'
        : 'The preview still shows the last successful version.';
    note.hidden = !isPreview || (preview.hidden && issues.length === 0);
    document.querySelector('#warning-items').replaceChildren(
        ...issues.map(({ path, message }) => {
            const { label, input } = describeIssue(path, data);
            const row = node('li', undefined, 'flex flex-wrap items-center justify-between gap-2 px-2.5 py-2');
            const detail = node('div', undefined, 'min-w-0 flex-1 basis-40 text-xs break-words');
            if (label) detail.append(node('p', label, 'mb-0.5 font-semibold'));
            detail.append(node('p', message, 'text-slate-700'));
            row.append(detail);
            if (input) {
                row.append(
                    button('Edit field', () => {
                        const panelId = input.closest('.editor-panel')?.id;
                        sectionNav.querySelector(`[aria-controls="${panelId}"]`)?.click();
                        input.focus();
                    }),
                );
            }
            return row;
        }),
    );
    status.hidden = true;
    warning.hidden = false;
}

function queuePreview() {
    revision++;
    clearTimeout(timer);
    pdfButton.disabled = true;
    printButton.disabled = true;
    warning.hidden = true;
    status.hidden = false;
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
    const data = payload();
    try {
        const response = await api('preview', data);
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
            showWarning(error, data, true);
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
    const data = payload();
    try {
        const response = await api('export/json', data);
        const url = URL.createObjectURL(await response.blob());
        download(url, 'resume.json');
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        showWarning(error, data);
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
        activePanel = 'profile';
        renderEditor();
        queuePreview();
    } catch (error) {
        showWarning(error);
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
        showWarning(error);
    });
