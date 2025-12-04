// Invoice Formatter - Static Version
// Runs entirely in the browser using File API and local storage

// Global state
let STATE = {
    projectFolder: null,
    config: null,
    ibanConfig: null,
    inputFiles: [],
    outputFiles: [],
    selectedInputs: new Set(),
    selectedOutputs: new Set(),
    conversion: {
        isRunning: false,
        abortController: null,
    }
};

// Default configuration (no personal information)
const DEFAULT_CONFIG = {
    bank: {
        account_name: "",
        bic: "",
        btw_number: ""
    },
    banner_path: "",
    column_settings: {
        show_action: false,
        show_date: true,
        show_description: true,
        show_discount: false,
        show_price: true,
        show_quantity: true,
        show_tax_amount: false,
        show_taxable: false,
        show_total: true
    },
    date_settings: {
        date_format: "%d/%m/%Y",
        due_date_format: "%d/%m/%Y",
        show_date: false,
        show_due_date: true
    },
    hide_empty_fields: false,
    payment_request: "We kindly request you to transfer the above-mentioned amount before the due date to the bank account mentioned above, quoting the invoice number.",
    summary_settings: {
        show_amount_due: true,
        show_net_price: false,
        show_tax: true,
        show_total_price: true
    },
    tax_message: "BTW (21%)",
    treasurer: {
        email: "",
        name: "",
        title: "Treasurer"
    }
};

const DEFAULT_IBAN_CONFIG = {
    iban: ""
};

// Utility functions
function toast(msg, kind = "") {
    const t = el("#toast");
    t.textContent = msg;
    t.style.borderColor = kind === "bad" ? "var(--bad)" : (kind === "good" ? "var(--good)" : "var(--border)");
    t.style.display = "block";
    setTimeout(() => t.style.display = "none", 2500);
}

function el(sel, root = document) {
    return root.querySelector(sel);
}

function els(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(n) {
    if (n === 0) return "0 B";
    const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return (n / Math.pow(k, i)).toFixed(i ? 1 : 0) + " " + sizes[i];
}

function timeAgo(t) {
    const d = Math.floor((Date.now() / 1000 - t) / 60);
    if (d <= 0) return "now";
    if (d < 60) return d + "m ago";
    const h = Math.floor(d / 60);
    if (h < 24) return h + "h ago";
    const days = Math.floor(h / 24);
    return days + "d ago";
}

// Configuration management
function loadConfigFromStorage() {
    try {
        const config = localStorage.getItem('invoice-formatter-config');
        const ibanConfig = localStorage.getItem('invoice-formatter-iban');
        
        STATE.config = config ? JSON.parse(config) : { ...DEFAULT_CONFIG };
        STATE.ibanConfig = ibanConfig ? JSON.parse(ibanConfig) : { ...DEFAULT_IBAN_CONFIG };
        
        updateFolderStatus();
        return true;
    } catch (e) {
        console.error('Failed to load config from storage:', e);
        STATE.config = { ...DEFAULT_CONFIG };
        STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG };
        return false;
    }
}

function saveConfigToStorage() {
    try {
        localStorage.setItem('invoice-formatter-config', JSON.stringify(STATE.config));
        localStorage.setItem('invoice-formatter-iban', JSON.stringify(STATE.ibanConfig));
        updateFolderStatus();
        return true;
    } catch (e) {
        console.error('Failed to save config to storage:', e);
        toast("Failed to save configuration", "bad");
        return false;
    }
}

function updateFolderStatus() {
    const status = el("#folder-status");
    if (STATE.projectFolder) {
        const inputCount = STATE.inputFiles.length;
        const outputCount = STATE.outputFiles.length;
        const hasConfig = STATE.config && STATE.ibanConfig;
        
        let statusText = `📁 ${STATE.projectFolder.name} - `;
        statusText += `${inputCount} input files, ${outputCount} output files`;
        
        if (hasConfig) {
            statusText += " - ✅ Config loaded";
            status.style.color = "var(--good)";
        } else {
            statusText += " - ⚠️ No config found";
            status.style.color = "var(--warn)";
        }
        
        status.textContent = statusText;
    } else {
        status.textContent = "No folder selected";
        status.style.color = "var(--muted)";
    }
}

// File handling
function downloadFile(content, filename, mimeType = 'text/yaml') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Folder handling
async function handleProjectFolder(files) {
    try {
        console.log('Processing project folder with', files.length, 'files');
        
        // Reset state
        STATE.projectFolder = { name: 'Selected Folder', files: [] };
        STATE.inputFiles = [];
        STATE.outputFiles = [];
        STATE.selectedInputs.clear();
        STATE.selectedOutputs.clear();
        
        // Process files
        const configFiles = {};
        const inputFiles = [];
        const outputFiles = [];
        let processedFiles = 0;
        
        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            console.log('Processing file:', path);
            
            const parts = path.split('/');
            console.log('Path parts:', parts);
            
            if (parts.length >= 3) {
                // Handle structure like: formatter/input/file.html
                const rootFolder = parts[0]; // formatter
                const folder = parts[1];     // input, output, config
                const filename = parts.slice(2).join('/');
                
                console.log(`Root: ${rootFolder}, Folder: ${folder}, Filename: ${filename}`);
                
                if (folder === 'config') {
                    if (filename === 'config.yml' || filename === 'config.yaml') {
                        console.log('Loading config.yml');
                        const text = await file.text();
                        configFiles.config = parseSimpleYaml(text);
                        processedFiles++;
                    } else if (filename === 'iban.yml' || filename === 'iban.yaml') {
                        console.log('Loading iban.yml');
                        const text = await file.text();
                        configFiles.iban = parseSimpleYaml(text);
                        processedFiles++;
                    }
                } else if (folder === 'input') {
                    if (filename.endsWith('.html')) {
                        console.log('Adding HTML file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified
                        };
                        inputFiles.push(fileObj);
                        processedFiles++;
                    }
                } else if (folder === 'output') {
                    // Load existing output files for display
                    if (filename.endsWith('.html') || filename.endsWith('.pdf')) {
                        console.log('Adding output file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified,
                            type: filename.endsWith('.pdf') ? 'pdf' : 'html'
                        };
                        outputFiles.push(fileObj);
                        processedFiles++;
                    }
                }
            } else if (parts.length >= 2) {
                // Handle direct structure like: input/file.html (for backward compatibility)
                const folder = parts[0];
                const filename = parts.slice(1).join('/');
                
                console.log(`Direct structure - Folder: ${folder}, Filename: ${filename}`);
                
                if (folder === 'config') {
                    if (filename === 'config.yml' || filename === 'config.yaml') {
                        console.log('Loading config.yml');
                        const text = await file.text();
                        configFiles.config = parseSimpleYaml(text);
                        processedFiles++;
                    } else if (filename === 'iban.yml' || filename === 'iban.yaml') {
                        console.log('Loading iban.yml');
                        const text = await file.text();
                        configFiles.iban = parseSimpleYaml(text);
                        processedFiles++;
                    }
                } else if (folder === 'input') {
                    if (filename.endsWith('.html')) {
                        console.log('Adding HTML file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified
                        };
                        inputFiles.push(fileObj);
                        processedFiles++;
                    }
                } else if (folder === 'output') {
                    // Load existing output files for display
                    if (filename.endsWith('.html') || filename.endsWith('.pdf')) {
                        console.log('Adding output file:', filename);
                        const fileObj = {
                            id: Date.now() + Math.random() + '_' + filename,
                            file: file,
                            name: filename,
                            size: file.size,
                            lastModified: file.lastModified,
                            type: filename.endsWith('.pdf') ? 'pdf' : 'html'
                        };
                        outputFiles.push(fileObj);
                        processedFiles++;
                    }
                }
            } else {
                console.log('Skipping file (not in expected folder structure):', path);
            }
        }
        
        console.log('Processed files:', processedFiles);
        console.log('Config files found:', Object.keys(configFiles));
        console.log('Input files found:', inputFiles.length);
        
        // Update configuration
        if (configFiles.config) {
            STATE.config = { ...DEFAULT_CONFIG, ...configFiles.config };
            console.log('Loaded config:', STATE.config);
        } else {
            STATE.config = { ...DEFAULT_CONFIG };
            console.log('Using default config');
        }
        
        if (configFiles.iban) {
            STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG, ...configFiles.iban };
            console.log('Loaded IBAN config:', STATE.ibanConfig);
        } else {
            STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG };
            console.log('Using default IBAN config');
        }
        
        // Update files
        STATE.inputFiles = inputFiles;
        STATE.outputFiles = outputFiles;
        
        // Save to localStorage
        saveConfigToStorage();
        
        // Update UI
        renderInputs();
        renderOutputs();
        updateFolderStatus();
        
        const configCount = Object.keys(configFiles).length;
        toast(`Loaded folder: ${inputFiles.length} input files, ${outputFiles.length} output files, ${configCount} config files`, "good");
        
    } catch (e) {
        console.error('Failed to handle project folder:', e);
        toast("Failed to load project folder: " + e.message, "bad");
    }
}

function clearProjectFolder() {
    STATE.projectFolder = null;
    STATE.inputFiles = [];
    STATE.outputFiles = [];
    STATE.selectedInputs.clear();
    STATE.selectedOutputs.clear();
    
    renderInputs();
    renderOutputs();
    updateFolderStatus();
    
    toast("Project folder cleared", "good");
}

function parseSimpleYaml(text) {
    const result = {};
    const lines = text.split('\n');
    const stack = [{ obj: result, indent: -1 }];
    
    for (let line of lines) {
        const originalLine = line;
        line = line.trim();
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#')) continue;
        
        const indent = originalLine.search(/\S/);
        const colonIndex = line.indexOf(':');
        
        if (colonIndex === -1) continue; // Skip lines without colons
        
        const key = line.substring(0, colonIndex).trim();
        const valuePart = line.substring(colonIndex + 1).trim();
        
        // Find the right parent level based on indentation
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        
        const current = stack[stack.length - 1].obj;
        
        if (valuePart) {
            // Handle different value types
            if (valuePart === 'null' || valuePart === '~') {
                current[key] = null;
            } else if (valuePart === 'true' || valuePart === 'false') {
                current[key] = valuePart === 'true';
            } else if (valuePart.match(/^[-+]?\d+$/)) {
                current[key] = parseInt(valuePart, 10);
            } else if (valuePart.match(/^[-+]?\d*\.\d+$/)) {
                current[key] = parseFloat(valuePart);
            } else if (valuePart.startsWith('"') || valuePart.startsWith("'")) {
                // Quoted string
                current[key] = valuePart.slice(1, -1);
            } else if (valuePart === '|') {
                // Multiline string (simplified - just take next non-empty line)
                const nextLineIndex = lines.indexOf(originalLine) + 1;
                let multilineValue = '';
                for (let i = nextLineIndex; i < lines.length; i++) {
                    const nextLine = lines[i].trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        multilineValue = nextLine.replace(/^["']|["']$/g, '');
                        break;
                    }
                }
                current[key] = multilineValue;
            } else {
                // Unquoted string
                current[key] = valuePart.replace(/^["']|["']$/g, '');
            }
        } else {
            // Object (nested structure)
            current[key] = {};
            stack.push({ obj: current[key], indent: indent });
        }
    }
    
    return result;
}

// Invoice parsing and conversion
function parseEasyInvoice(html) {
    const data = {};
    
    // Extract invoice number
    const invoiceMatch = html.match(/Invoice\s*#([A-Za-z0-9_.\-]+)/);
    data.invoice_number = invoiceMatch ? invoiceMatch[1] : '';
    
    // Extract dates
    data.date = extractLabelValue(html, "Date");
    data.due_date = extractLabelValue(html, "Due Date");
    
    // Extract client and company info
    data.client_name_html = extractDivClass(html, "client-name");
    data.client_address_html = extractDivClass(html, "client-address");
    data.company_name_html = extractDivClass(html, "company-name");
    data.company_address_html = extractDivClass(html, "company-address");
    
    // Extract entries table
    const entriesHtml = extractEntriesTable(html);
    const { items, summary } = parseEntriesTable(entriesHtml);
    
    data.items = items;
    data.summary = summary;
    
    return data;
}

function extractLabelValue(html, label) {
    const pattern = new RegExp(`<td>\\s*${label}\\s*:\\s*</td>\\s*<td>\\s*<div[^>]*>(.*?)</div>`, 'i');
    const match = html.match(pattern);
    if (match) {
        return collapseWs(stripTags(match[1]));
    }
    return '';
}

function extractDivClass(html, className) {
    const pattern = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>(.*?)</div>`, 'i');
    const match = html.match(pattern);
    return match ? match[1].trim() : '';
}

function extractEntriesTable(html) {
    const match = html.match(/<div class="entries-table">(.*?)<\/div>\s*<\/td>/is);
    return match ? match[1] : '';
}

function parseEntriesTable(html) {
    const items = [];
    const summary = { net: '', tax: '', total: '', due: '' };
    
    const trMatches = html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis);
    
    for (const trMatch of trMatches) {
        const trHtml = trMatch[1];
        const tdMatches = trHtml.matchAll(/<td[^>]*>(.*?)<\/td>/gis);
        const cells = Array.from(tdMatches, m => m[1]);
        
        if (cells.length === 0) continue;
        
        const firstCellText = collapseWs(stripTags(cells[0])).toLowerCase();
        
        // Check if this is a summary row
        const labelMap = {
            "net price": "net",
            "tax": "tax",
            "total price": "total",
            "amount due": "due",
        };
        
        if (labelMap[firstCellText]) {
            const currencyMatch = trHtml.match(/[€\u20AC]\s?[\d.,]+/);
            if (currencyMatch) {
                summary[labelMap[firstCellText]] = currencyMatch[0];
            }
            continue;
        }
        
        // Parse item row
        const item = {};
        const columnOrder = ["date", "description", "action", "quantity", "unit_price", "discount", "taxable", "total"];
        
        cells.forEach((cell, index) => {
            if (index < columnOrder.length) {
                item[columnOrder[index]] = collapseWs(stripTags(cell));
            }
        });
        
        if (item.date || item.description) {
            items.push(item);
        }
    }
    
    return { items, summary };
}

function stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
}

function collapseWs(s) {
    return s.replace(/\s+/g, ' ').trim();
}

function formatDateString(dateStr, dateFormat) {
    if (!dateStr || !dateStr.trim()) return dateStr;
    
    // Try to parse common date formats
    const dateFormats = [
        "%Y-%m-%d",
        "%d/%m/%Y", 
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%m-%d-%Y",
        "%Y/%m/%d"
    ];
    
    for (const fmt of dateFormats) {
        try {
            const parsed = parseDateString(dateStr, fmt);
            if (parsed) {
                return formatDateString(parsed, dateFormat);
            }
        } catch (e) {
            continue;
        }
    }
    
    return dateStr;
}

function parseDateString(dateStr, format) {
    // Simple date parsing - this is a basic implementation
    // In a real implementation, you'd want a more robust date parser
    const cleanStr = dateStr.replace(/[^\d\/\-]/g, '');
    
    if (format === "%Y-%m-%d" || format === "%Y/%m/%d") {
        const parts = cleanStr.split(/[-\/]/);
        if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }
    } else if (format === "%d/%m/%Y" || format === "%d-%m-%Y") {
        const parts = cleanStr.split(/[-\/]/);
        if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]);
        }
    } else if (format === "%m/%d/%Y" || format === "%m-%d-%Y") {
        const parts = cleanStr.split(/[-\/]/);
        if (parts.length === 3) {
            return new Date(parts[2], parts[0] - 1, parts[1]);
        }
    }
    
    return null;
}

function buildImprovedHtml(data, config, ibanConfig) {
    const c = config || {};
    const iban = ibanConfig || {};
    
    const bannerHtml = c.banner_path ?
        `<tr><td align="left"><img src="${escapeHtml(c.banner_path)}" alt="Invoice Banner" onerror="this.style.display='none'; this.alt='Banner not found: ${escapeHtml(c.banner_path)}';" /></td></tr>` : "";
    
    // Build headers based on column settings
    const columnSettings = c.column_settings || {};
    const headers = [];
    if (columnSettings.show_date !== false) headers.push("Date");
    if (columnSettings.show_description !== false) headers.push("Description");
    if (columnSettings.show_action) headers.push("Action");
    if (columnSettings.show_quantity) headers.push("Quantity");
    if (columnSettings.show_price) headers.push("Price");
    if (columnSettings.show_discount) headers.push("Discount");
    if (columnSettings.show_taxable) headers.push("Taxable");
    if (columnSettings.show_tax_amount) headers.push("Tax Amount");
    if (columnSettings.show_total !== false) headers.push("Total");
    
    // Build item rows
    const itemRows = [];
    data.items.forEach((item, i) => {
        const bg = i === 0 ? "#92a7b6" : "#ffffff";
        const cells = [];
        
        function getCell(key, defaultVal = "") {
            const value = item[key] || defaultVal;
            if (c.hide_empty_fields && !value.trim()) return "";
            return escapeHtml(value);
        }
        
        if (columnSettings.show_date !== false) {
            const dateVal = getCell("date");
            cells.push(`<td>${dateVal}</td>`);
        }
        if (columnSettings.show_description !== false) {
            const descVal = getCell("description");
            cells.push(`<td>${descVal}</td>`);
        }
        if (columnSettings.show_action) {
            cells.push(`<td>${getCell("action")}</td>`);
        }
        if (columnSettings.show_quantity) {
            cells.push(`<td class="number-cell">${getCell("quantity")}</td>`);
        }
        if (columnSettings.show_price) {
            cells.push(`<td class="number-cell">${getCell("unit_price")}</td>`);
        }
        if (columnSettings.show_discount) {
            cells.push(`<td class="number-cell">${getCell("discount")}</td>`);
        }
        if (columnSettings.show_taxable) {
            cells.push(`<td>${getCell("taxable")}</td>`);
        }
        if (columnSettings.show_tax_amount) {
            cells.push(`<td class="number-cell">${getCell("tax_amount")}</td>`);
        }
        if (columnSettings.show_total !== false) {
            cells.push(`<td class="number-cell">${getCell("total")}</td>`);
        }
        
        itemRows.push(`<tr bgcolor="${bg}">${cells.join('')}</tr>`);
    });
    
    // Build summary rows
    const summarySettings = c.summary_settings || {};
    const summary = data.summary || {};
    const taxLabel = c.tax_message || "BTW (21%)";
    
    const summaryRows = [];
    if (summarySettings.show_net_price !== false && summary.net) {
        summaryRows.push(["Net Price", summary.net]);
    }
    if (summarySettings.show_tax !== false && summary.tax) {
        summaryRows.push([taxLabel, summary.tax]);
    }
    if (summarySettings.show_total_price !== false && summary.total) {
        summaryRows.push(["Total Price", summary.total]);
    }
    if (summarySettings.show_amount_due !== false && summary.due) {
        summaryRows.push(["Amount Due", summary.due]);
    }
    
    const summaryColspan = Math.max(1, headers.length - 1);
    const summaryHtml = summaryRows.map(([label, value]) => 
        `<tr bgcolor="#ffffff"><td class="total-label-cell">${escapeHtml(label)}</td>` +
        `<td class="total-number-cell" colspan="${summaryColspan}">${escapeHtml(value)}</td></tr>`
    ).join('');
    
    // Build notes
    const notesLines = [];
    
    if (iban.iban || c.bank?.bic || c.bank?.btw_number) {
        notesLines.push("", "");
        if (iban.iban) notesLines.push(`IBAN: ${iban.iban}`);
        if (c.bank?.bic) notesLines.push(`BIC: ${c.bank.bic}`);
        if (c.bank?.btw_number) notesLines.push(`BTW number: ${c.bank.btw_number}`);
        notesLines.push("", "");
    }
    
    if (c.payment_request) {
        notesLines.push(...c.payment_request.split('\n'));
    } else {
        notesLines.push(
            "We kindly request you to transfer the above-mentioned amount before the due date",
            "to the bank account mentioned above in the name of Stichting Studiereis Astatine in Enschede,",
            "quoting the invoice number."
        );
    }
    
    notesLines.push("", "With kind regards,", "");
    if (c.treasurer?.name) notesLines.push(c.treasurer.name);
    if (c.treasurer?.title) notesLines.push(c.treasurer.title);
    if (c.treasurer?.email) notesLines.push(c.treasurer.email);
    
    const notesHtml = notesLines.map(line => escapeHtml(line)).join('<br />');
    
    // Date settings
    const dateSettings = c.date_settings || {};
    const showDate = dateSettings.show_date !== false && data.date;
    const showDueDate = dateSettings.show_due_date !== false && data.due_date;
    
    return `<!DOCTYPE html>
<html dir='auto'>
<head>
<meta http-equiv="content-type" content="text/html; charset=utf-8" />
<style type="text/css">
img {
    max-width: 100%;
    width: 1006px;
    display: block;
    margin-left: auto;
    margin-right: auto;
}
@media (prefers-color-scheme: dark) {body {color: #000; background-color: #fff;}}
h3 { font-family: "Open Sans", sans-serif; font-size: 15pt; font-weight: bold; }
a { font-family: "Open Sans", sans-serif; font-size: 10pt; font-style: italic; }
body, p, table, tr, td { vertical-align: top; font-family: "Open Sans", sans-serif; font-size: 11pt; }
tr.alternate-row { background: #ffffff }
tr { page-break-inside: avoid !important;}
html, body { height: 100vh; margin: 0 8px; }
td, th { border-color: grey }
th.column-heading-left { text-align: left; font-family: "Open Sans", sans-serif; font-size: 10pt; }
th.column-heading-center { text-align: center; font-family: "Open Sans", sans-serif; font-size: 10pt; }
th.column-heading-right { text-align: right; font-family: "Open Sans", sans-serif; font-size: 10pt; }
td.highlight {background-color:#e1e1e1}
td.neg { color: red; }
td.number-cell, td.total-number-cell { text-align: right; white-space: nowrap; }
td.date-cell { white-space: nowrap; }
td.anchor-cell { white-space: nowrap; font-family: "Open Sans", sans-serif; font-size: 11pt; }
td.number-cell { font-family: "Open Sans", sans-serif; font-size: 12pt; }
td.number-header { text-align: right; font-family: "Open Sans", sans-serif; font-size: 10pt; }
td.text-cell { font-family: "Open Sans", sans-serif; font-size: 11pt; }
td.total-number-cell { font-family: "Open Sans", sans-serif; font-size: 12pt; }
td.total-label-cell { font-family: "Open Sans", sans-serif; font-size: 12pt; }
td.centered-label-cell { text-align: center; font-family: "Open Sans", sans-serif; font-size: 12pt; font-weight: bold; }
sub { top: 0.4em; }
sub, sup { vertical-align: baseline; position: relative; top: -0.4em; }
@media print { html, body { height: unset; }}
.div-align-right { float: right; }
.div-align-right .maybe-align-right { text-align: right }
.entries-table * { border-width: 1px; border-style:solid; border-collapse: collapse}
.entries-table > table { width: 100% }
.company-table > table * { padding: 0px; }
.client-table > table * { padding: 0px; }
.invoice-details-table > table * { padding: 0px; text-indent: 0.2em; }
@media print { .main-table > table { width: 75%; }}
.company-name, .client-name { font-size: x-large; margin: 0; line-height: 1.25; }
.client-table .client-name { text-align: left; }
.client-table .maybe-align-right { text-align: left; }
.invoice-title { font-weight: bold; }
.invoice-notes { margin-top: 0; width: 100%; }
</style>
</head>
<body text="#000000" link="#1c3661" bgcolor="#ffffff">
<table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
  <tbody>
    ${bannerHtml}
    <tr><td><h3></h3></td></tr>
    <tr><td>
      <div class="main-table">
        <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
          <tbody>
            <tr><td colspan="2"><div class="invoice-title">Invoice #${escapeHtml(data.invoice_number || "")}</div></td></tr>
            <tr>
              <td> </td>
              <td>
                <div class="div-align-right">
                  <div class="invoice-details-table">
                    <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
                      <tbody>
                        ${showDate ? `<tr><td>Date:</td><td><div class="div-align-right">${escapeHtml(data.date || "")}</div></td></tr>` : ''}
                        ${showDueDate ? `<tr><td>Due Date:</td><td><div class="div-align-right">${escapeHtml(data.due_date || "")}</div></td></tr>` : ''}
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td>
                <div class="client-table">
                  <table cellspacing="1" cellpadding="1" border="0" style="margin-left:0; margin-right:0">
                    <tbody>
                      <tr><td><div class="maybe-align-right client-name">${data.client_name_html || ""}</div></td></tr>
                      <tr><td><div class="maybe-align-right client-address">${data.client_address_html || ""}</div></td></tr>
                    </tbody>
                  </table>
                </div>
              </td>
              <td>
                <div class="div-align-right">
                  <div class="company-table">
                    <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
                      <tbody>
                        <tr><td><div class="maybe-align-right company-name">${data.company_name_html || ""}</div></td></tr>
                        <tr><td><div class="maybe-align-right company-address">${data.company_address_html || ""}</div></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
            <tr><td> </td><td><div class="div-align-right"> </div></td></tr>
            <tr>
              <td colspan="2">
                <div class="entries-table">
                  <table cellspacing="1" cellpadding="1" border="0" style="margin-left:auto; margin-right:auto">
                    <thead>
                      <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                      ${itemRows.join('')}
                      ${summaryHtml}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
            <tr>
              <td colspan="2">
                <div class="invoice-notes">${notesHtml}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </td></tr>
  </tbody>
</table>
</body>
</html>`;
}

// UI rendering
function renderInputs() {
    const box = el("#inputs-list");
    const dropZone = el("#drop-zone");
    
    if (STATE.inputFiles.length === 0) {
        box.classList.add("hidden");
        dropZone.classList.remove("hidden");
        return;
    }
    
    box.classList.remove("hidden");
    dropZone.classList.add("hidden");
    
    // Clear existing rows
    els(".rowi", box).forEach(n => n.remove());
    
    STATE.inputFiles.forEach(file => {
        const row = document.createElement("div");
        row.className = "rowi";
        row.innerHTML = `
            <div><input type="checkbox" class="pick" data-id="${file.id}" /></div>
            <div class="mono" title="${file.name}">${file.name}<div class="pill">${formatBytes(file.size)}</div></div>
            <div class="actions">
                <button class="btn ghost small preview" data-id="${file.id}">👁️ Preview</button>
                <button class="btn ghost small remove" data-id="${file.id}">🗑️ Remove</button>
            </div>
        `;
        box.appendChild(row);
        
        const checkbox = row.querySelector("input.pick");
        checkbox.checked = STATE.selectedInputs.has(file.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                STATE.selectedInputs.add(file.id);
            } else {
                STATE.selectedInputs.delete(file.id);
            }
            updateSelectAllCheckbox('inputs');
        });
        
        row.querySelector("button.preview").addEventListener("click", () => {
            previewInputFile(file);
        });
        
        row.querySelector("button.remove").addEventListener("click", () => {
            removeInputFile(file.id);
        });
    });
    
    updateSelectAllCheckbox('inputs');
}

function renderOutputs() {
    const box = el("#outputs-list");
    
    // Clear existing rows
    els(".rowi", box).forEach(n => n.remove());
    
    STATE.outputFiles.forEach(file => {
        const row = document.createElement("div");
        row.className = "rowi";
        row.innerHTML = `
            <div><input type="checkbox" class="pick" data-id="${file.id}" /></div>
            <div class="mono" title="${file.name}">${file.name}<div class="pill">${formatBytes(file.size)}</div></div>
            <div class="actions">
                <button class="btn ghost small preview" data-id="${file.id}">👁️ Preview</button>
                <button class="btn ghost small download" data-id="${file.id}">📥 Download</button>
                <button class="btn ghost small print" data-id="${file.id}">🖨️ Print</button>
            </div>
        `;
        box.appendChild(row);
        
        const checkbox = row.querySelector("input.pick");
        checkbox.checked = STATE.selectedOutputs.has(file.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                STATE.selectedOutputs.add(file.id);
            } else {
                STATE.selectedOutputs.delete(file.id);
            }
            updateSelectAllCheckbox('outputs');
        });
        
        row.querySelector("button.preview").addEventListener("click", () => {
            previewOutputFile(file);
        });
        
        row.querySelector("button.download").addEventListener("click", () => {
            downloadOutputFile(file);
        });
        
        row.querySelector("button.print").addEventListener("click", () => {
            printOutputFile(file);
        });
    });
    
    updateSelectAllCheckbox('outputs');
}

function updateSelectAllCheckbox(listName) {
    const selectAllCheckbox = el(`#select-all-${listName}`);
    const selectedSet = listName === 'inputs' ? STATE.selectedInputs : STATE.selectedOutputs;
    const items = listName === 'inputs' ? STATE.inputFiles : STATE.outputFiles;
    
    if (!selectAllCheckbox || items.length === 0) return;
    
    if (selectedSet.size === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedSet.size === items.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// File operations
function addInputFiles(files) {
    const newFiles = [];
    
    for (const file of files) {
        if (!file.name.endsWith('.html')) continue;
        
        const fileObj = {
            id: Date.now() + Math.random() + '_' + file.name,
            file: file,
            name: file.name,
            size: file.size,
            lastModified: file.lastModified
        };
        
        STATE.inputFiles.push(fileObj);
        newFiles.push(fileObj);
    }
    
    if (newFiles.length > 0) {
        renderInputs();
        toast(`Added ${newFiles.length} file(s)`, "good");
    } else {
        toast("No HTML files found", "warn");
    }
}

function removeInputFile(fileId) {
    STATE.inputFiles = STATE.inputFiles.filter(f => f.id !== fileId);
    STATE.selectedInputs.delete(fileId);
    renderInputs();
}

async function previewInputFile(fileObj) {
    try {
        const text = await fileObj.file.text();
        const newWindow = window.open('', '_blank');
        newWindow.document.write(text);
        newWindow.document.close();
    } catch (e) {
        toast("Failed to preview file", "bad");
    }
}

function previewOutputFile(fileObj) {
    const newWindow = window.open('', '_blank');
    newWindow.document.write(fileObj.content);
    newWindow.document.close();
}

function downloadOutputFile(fileObj) {
    downloadFile(fileObj.content, fileObj.name, 'text/html');
}

function printOutputFile(fileObj) {
    const newWindow = window.open('', '_blank');
    newWindow.document.write(fileObj.content);
    newWindow.document.close();
    newWindow.print();
}

// Conversion process
async function convertFiles(selectedOnly = false) {
    if (STATE.conversion.isRunning) {
        toast("Conversion already in progress", "warn");
        return;
    }
    
    const filesToConvert = selectedOnly ? 
        STATE.inputFiles.filter(f => STATE.selectedInputs.has(f.id)) :
        STATE.inputFiles;
    
    if (filesToConvert.length === 0) {
        toast("No files to convert", "warn");
        return;
    }
    
    STATE.conversion.isRunning = true;
    showProgress(true);
    updateProgress(0, "Starting conversion...");
    
    const keepHtml = el("#opt-keep-html").checked;
    const debug = el("#opt-debug").checked;
    
    let converted = 0;
    let errors = 0;
    
    for (let i = 0; i < filesToConvert.length; i++) {
        const fileObj = filesToConvert[i];
        
        try {
            updateProgress(
                Math.round((i / filesToConvert.length) * 100),
                `Processing ${fileObj.name} (${i + 1}/${filesToConvert.length})...`
            );
            
            const html = await fileObj.file.text();
            const data = parseEasyInvoice(html);
            
            if (!data.invoice_number) {
                console.warn(`Could not extract invoice number from ${fileObj.name}`);
            }
            
            const improvedHtml = buildImprovedHtml(data, STATE.config, STATE.ibanConfig);
            
            // Generate filename
            const clientName = collapseWs(stripTags(data.client_name_html || ""));
            const sanitizedName = clientName.replace(/[^A-Za-z0-9_.\-]+/g, '-').replace(/\s+/g, '_') || "UNKNOWN_CLIENT";
            const sanitizedInvoice = (data.invoice_number || "UNKNOWN").replace(/[^A-Za-z0-9_.\-]+/g, '-');
            const baseFilename = `Invoice-${sanitizedInvoice}-${sanitizedName}`;
            
            // Add HTML output
            if (keepHtml) {
                const htmlFileObj = {
                    id: Date.now() + Math.random() + '_' + baseFilename + '-improved.html',
                    name: baseFilename + '-improved.html',
                    size: new Blob([improvedHtml]).size,
                    content: improvedHtml,
                    type: 'html'
                };
                STATE.outputFiles.push(htmlFileObj);
            }
            
            converted++;
            
            if (debug) {
                console.log(`Converted ${fileObj.name} -> ${baseFilename}`);
            }
            
        } catch (e) {
            console.error(`Failed to convert ${fileObj.name}:`, e);
            errors++;
        }
        
        // Small delay to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    updateProgress(100, `Conversion complete. ${converted} converted, ${errors} errors.`);
    renderOutputs();
    
    setTimeout(() => {
        showProgress(false);
        toast(`Conversion complete. ${converted} file(s) converted.`, errors > 0 ? "warn" : "good");
    }, 1000);
    
    STATE.conversion.isRunning = false;
}

// Progress handling
function showProgress(show = true) {
    const container = el("#progress-container");
    if (show) {
        container.classList.remove("hidden");
        updateProgress(0, "Preparing...");
    } else {
        container.classList.add("hidden");
    }
}

function updateProgress(percent, text) {
    el("#progress-fill").style.width = percent + "%";
    el("#progress-text").textContent = text;
}

// Configuration modal
function renderConfigModal() {
    const c = STATE.config || {};
    const iban = STATE.ibanConfig || {};
    
    // General tab
    el("#cfg-banner").value = c.banner_path || "";
    
    // Add banner preview if path exists
    updateBannerPreview(c.banner_path);
    el("#cfg-treasurer-name").value = (c.treasurer && c.treasurer.name) || "";
    el("#cfg-treasurer-email").value = (c.treasurer && c.treasurer.email) || "";
    el("#cfg-treasurer-title").value = (c.treasurer && c.treasurer.title) || "";
    el("#cfg-payment-request").value = c.payment_request || "";
    el("#cfg-tax-message").value = c.tax_message || "BTW (21%)";
    el("#cfg-hide-empty-fields").checked = c.hide_empty_fields !== false;
    
    // Bank tab
    el("#cfg-bank-bic").value = (c.bank && c.bank.bic) || "";
    el("#cfg-bank-btw").value = (c.bank && c.bank.btw_number) || "";
    el("#cfg-bank-account-name").value = (c.bank && c.bank.account_name) || "";
    el("#cfg-bank-iban").value = iban.iban || "";
    
    // Dates tab
    const dateSettings = c.date_settings || {};
    el("#cfg-show-date").checked = dateSettings.show_date !== false;
    el("#cfg-show-due-date").checked = dateSettings.show_due_date !== false;
    el("#cfg-date-format").value = dateSettings.date_format || "%d/%m/%Y";
    el("#cfg-due-date-format").value = dateSettings.due_date_format || "%d/%m/%Y";
    
    // Columns tab
    const columnSettings = c.column_settings || {};
    el("#cfg-col-show-date").checked = columnSettings.show_date !== false;
    el("#cfg-col-show-description").checked = columnSettings.show_description !== false;
    el("#cfg-col-show-action").checked = columnSettings.show_action || false;
    el("#cfg-col-show-quantity").checked = columnSettings.show_quantity || false;
    el("#cfg-col-show-price").checked = columnSettings.show_price || false;
    el("#cfg-col-show-discount").checked = columnSettings.show_discount || false;
    el("#cfg-col-show-taxable").checked = columnSettings.show_taxable || false;
    el("#cfg-col-show-tax-amount").checked = columnSettings.show_tax_amount || false;
    el("#cfg-col-show-total").checked = columnSettings.show_total !== false;
    
    // Summary tab
    const summarySettings = c.summary_settings || {};
    el("#cfg-summary-show-net-price").checked = summarySettings.show_net_price !== false;
    el("#cfg-summary-show-tax").checked = summarySettings.show_tax !== false;
    el("#cfg-summary-show-total-price").checked = summarySettings.show_total_price !== false;
    el("#cfg-summary-show-amount-due").checked = summarySettings.show_amount_due !== false;
}

function saveConfigFromModal() {
    const c = STATE.config || {};
    
    // General
    const bannerPath = el("#cfg-banner").value || null;
    c.banner_path = bannerPath;
    
    // Validate banner path
    if (bannerPath && bannerPath.trim()) {
        validateBannerPath(bannerPath);
    }
    c.payment_request = el("#cfg-payment-request").value || null;
    c.tax_message = el("#cfg-tax-message").value || "BTW (21%)";
    c.hide_empty_fields = el("#cfg-hide-empty-fields").checked;
    
    // Treasurer
    c.treasurer = c.treasurer || {};
    c.treasurer.name = el("#cfg-treasurer-name").value || null;
    c.treasurer.email = el("#cfg-treasurer-email").value || null;
    c.treasurer.title = el("#cfg-treasurer-title").value || null;
    
    // Bank
    c.bank = c.bank || {};
    c.bank.bic = el("#cfg-bank-bic").value || null;
    c.bank.btw_number = el("#cfg-bank-btw").value || null;
    c.bank.account_name = el("#cfg-bank-account-name").value || null;
    
    // IBAN (separate config)
    STATE.ibanConfig = STATE.ibanConfig || {};
    STATE.ibanConfig.iban = el("#cfg-bank-iban").value || null;
    
    // Date settings
    c.date_settings = c.date_settings || {};
    c.date_settings.show_date = el("#cfg-show-date").checked;
    c.date_settings.show_due_date = el("#cfg-show-due-date").checked;
    c.date_settings.date_format = el("#cfg-date-format").value || "%d/%m/%Y";
    c.date_settings.due_date_format = el("#cfg-due-date-format").value || "%d/%m/%Y";
    
    // Column settings
    c.column_settings = c.column_settings || {};
    c.column_settings.show_date = el("#cfg-col-show-date").checked;
    c.column_settings.show_description = el("#cfg-col-show-description").checked;
    c.column_settings.show_action = el("#cfg-col-show-action").checked;
    c.column_settings.show_quantity = el("#cfg-col-show-quantity").checked;
    c.column_settings.show_price = el("#cfg-col-show-price").checked;
    c.column_settings.show_discount = el("#cfg-col-show-discount").checked;
    c.column_settings.show_taxable = el("#cfg-col-show-taxable").checked;
    c.column_settings.show_tax_amount = el("#cfg-col-show-tax-amount").checked;
    c.column_settings.show_total = el("#cfg-col-show-total").checked;
    
    // Summary settings
    c.summary_settings = c.summary_settings || {};
    c.summary_settings.show_net_price = el("#cfg-summary-show-net-price").checked;
    c.summary_settings.show_tax = el("#cfg-summary-show-tax").checked;
    c.summary_settings.show_total_price = el("#cfg-summary-show-total-price").checked;
    c.summary_settings.show_amount_due = el("#cfg-summary-show-amount-due").checked;
    
    saveConfigToStorage();
    toast("Configuration saved", "good");
}

function validateBannerPath(bannerPath) {
    // Check if it's a data URL
    if (bannerPath.startsWith('data:image/')) {
        return true;
    }
    
    // Check if it's an absolute URL (http/https)
    if (bannerPath.startsWith('http://') || bannerPath.startsWith('https://')) {
        return true;
    }
    
    // For relative paths, show a warning about the limitations
    if (bannerPath.startsWith('../') || bannerPath.startsWith('./')) {
        toast("Note: Relative banner paths may not work in browser preview. Consider using absolute URLs or data URLs.", "warn");
    }
    
    return true;
}

function updateBannerPreview(bannerPath) {
    const previewContainer = el("#banner-preview");
    if (!previewContainer) return;
    
    if (!bannerPath || !bannerPath.trim()) {
        previewContainer.innerHTML = '<p class="hint muted small">No banner configured</p>';
        return;
    }
    
    const img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100px';
    img.style.objectFit = 'contain';
    img.alt = 'Banner preview';
    
    img.onload = () => {
        previewContainer.innerHTML = '';
        previewContainer.appendChild(img);
    };
    
    img.onerror = () => {
        previewContainer.innerHTML = `<p class="hint muted small" style="color: var(--warn)">Banner not found: ${escapeHtml(bannerPath)}</p>`;
    };
    
    img.src = bannerPath;
}

// Event handlers
function wire() {
    // Tab switching
    els('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            els('.tab').forEach(t => t.classList.remove('active'));
            els('.tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const content = el(`#tab-${tabName}`);
            if (content) content.classList.add('active');
        });
    });
    
    // Project folder handlers
    el("#input-project-folder").addEventListener("change", (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            handleProjectFolder(files);
        }
        e.target.value = ''; // Reset input
    });
    
    el("#btn-clear-folder").addEventListener("click", clearProjectFolder);
    
    // File input handlers (fallback if no folder selected)
    el("#input-files").addEventListener("change", (e) => {
        addInputFiles(e.target.files);
        e.target.value = ''; // Reset input
    });
    
    // Drag and drop
    const dropZone = el("#drop-zone");
    const inputsCard = el("#inputs-card");
    
    [dropZone, inputsCard].forEach(element => {
        element.addEventListener('dragover', e => {
            e.preventDefault();
            element.style.borderColor = 'var(--accent)';
            element.style.backgroundColor = 'rgba(28, 126, 214, 0.1)';
        });
        
        element.addEventListener('dragleave', e => {
            e.preventDefault();
            element.style.borderColor = 'var(--border)';
            element.style.backgroundColor = 'transparent';
        });
        
        element.addEventListener('drop', e => {
            e.preventDefault();
            element.style.borderColor = 'var(--border)';
            element.style.backgroundColor = 'transparent';
            addInputFiles(e.dataTransfer.files);
        });
    });
    
    // Conversion buttons
    el("#btn-convert").addEventListener("click", () => convertFiles(true));
    el("#btn-convert-all").addEventListener("click", () => convertFiles(false));
    
    // Clear selected
    el("#btn-clear-selected").addEventListener("click", () => {
        const selectedCount = STATE.selectedInputs.size;
        if (selectedCount === 0) {
            toast("No files selected", "warn");
            return;
        }
        
        if (confirm(`Remove ${selectedCount} selected file(s)?`)) {
            STATE.inputFiles = STATE.inputFiles.filter(f => !STATE.selectedInputs.has(f.id));
            STATE.selectedInputs.clear();
            renderInputs();
            toast(`Removed ${selectedCount} file(s)`, "good");
        }
    });
    
    
    // Configuration modal
    el("#btn-edit-config").addEventListener("click", () => {
        renderConfigModal();
        el("#config-modal").classList.remove("hidden");
    });
    
    el("#cfg-cancel").addEventListener("click", () => {
        el("#config-modal").classList.add("hidden");
    });
    
    el("#cfg-save").addEventListener("click", () => {
        saveConfigFromModal();
        el("#config-modal").classList.add("hidden");
    });
    
    // Select all checkboxes
    el("#select-all-inputs").addEventListener("change", () => {
        const checked = el("#select-all-inputs").checked;
        if (checked) {
            STATE.inputFiles.forEach(f => STATE.selectedInputs.add(f.id));
        } else {
            STATE.selectedInputs.clear();
        }
        renderInputs();
    });
    
    el("#select-all-outputs").addEventListener("change", () => {
        const checked = el("#select-all-outputs").checked;
        if (checked) {
            STATE.outputFiles.forEach(f => STATE.selectedOutputs.add(f.id));
        } else {
            STATE.selectedOutputs.clear();
        }
        renderOutputs();
    });
    
    // Close modal on backdrop click
    el("#config-modal").addEventListener("click", (e) => {
        if (e.target === el("#config-modal") || e.target.classList.contains("modal-backdrop")) {
            el("#config-modal").classList.add("hidden");
        }
    });
    
    // Banner path input listener for live preview
    el("#cfg-banner").addEventListener("input", (e) => {
        updateBannerPreview(e.target.value);
    });
}

// Initialize
function init() {
    loadConfigFromStorage();
    wire();
    renderInputs();
    renderOutputs();
}

// Start the application
init();