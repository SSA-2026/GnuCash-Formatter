import { readFileAsDataURL, escapeHtml } from './utils.js';
import { STATE } from './state.js';

export async function buildImprovedHtml(data, config, ibanConfig) {
    const bannerDataUrl = await loadBanner(config);
    const bannerHtml = createBannerHtml(bannerDataUrl, config);
    
    const headers = buildHeaders(config);
    const itemRows = buildItemRows(data.items, config);
    const summaryHtml = buildSummaryHtml(data.summary, config);
    const notesHtml = buildNotesHtml(config, ibanConfig, data);
    
    const pageTitle = generatePageTitle(data);
    const dateSettings = config.date_settings || {};
    const showDate = dateSettings.show_date !== false && data.date;
    const showDueDate = dateSettings.show_due_date !== false && data.due_date;

    return generateHtmlTemplate({
        pageTitle,
        bannerHtml,
        data,
        showDate,
        showDueDate,
        headers,
        itemRows,
        summaryHtml,
        notesHtml,
        config
    });
}

async function loadBanner(config) {
    if (!config.banner_path || !STATE.projectDirectoryHandle || 
        config.banner_path.startsWith('http') || config.banner_path.startsWith('data:')) {
        return null;
    }

    try {
        let bannerFilename = config.banner_path;
        if (bannerFilename.startsWith('./')) bannerFilename = bannerFilename.substring(2);
        if (bannerFilename.startsWith('config/')) bannerFilename = bannerFilename.substring(7);
        
        const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
        const fileHandle = await configHandle.getFileHandle(bannerFilename);
        const file = await fileHandle.getFile();
        return await readFileAsDataURL(file);
    } catch (e) {
        console.warn("Could not load banner from project:", e);
        return null;
    }
}

function createBannerHtml(bannerDataUrl, config) {
    if (!bannerDataUrl && !config.banner_path) return '';
    
    let imgSrc = '';
    let onError = '';
    
    if (bannerDataUrl) {
        imgSrc = bannerDataUrl;
    } else if (config.banner_path.startsWith('http') || config.banner_path.startsWith('data:')) {
        imgSrc = escapeHtml(config.banner_path);
        onError = `onerror="this.style.display='none'; this.alt='Banner not found: ${escapeHtml(config.banner_path)}';"`;
    } else {
        const bannerPath = config.banner_path.startsWith('./') ? 
            config.banner_path.substring(2) : config.banner_path;
        imgSrc = `config/${bannerPath}`;
        onError = `onerror="this.style.display='none'; this.alt='Banner not found: config/${bannerPath}';"`;
    }
    
    return `<img src="${imgSrc}" alt="Invoice Banner" style="width: 100%; display: block; margin: 0; padding: 0;" ${onError} />`;
}

function buildHeaders(config) {
    const columnSettings = config.column_settings || {};
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
    
    return headers;
}

function buildItemRows(items, config) {
    const columnSettings = config.column_settings || {};
    
    return items.map((item, i) => {
        const bg = i === 0 ? "#92a7b6" : "#ffffff";
        const cells = [];
        
        function getCell(key, defaultVal = "") {
            const value = item[key] || defaultVal;
            if (config.hide_empty_fields && !value.trim()) return "";
            return escapeHtml(value);
        }
        
        if (columnSettings.show_date !== false) cells.push(`<td>${getCell("date")}</td>`);
        if (columnSettings.show_description !== false) cells.push(`<td>${getCell("description")}</td>`);
        if (columnSettings.show_action) cells.push(`<td>${getCell("action")}</td>`);
        if (columnSettings.show_quantity) cells.push(`<td class="number-cell">${getCell("quantity")}</td>`);
        if (columnSettings.show_price) cells.push(`<td class="number-cell">${getCell("unit_price")}</td>`);
        if (columnSettings.show_discount) cells.push(`<td class="number-cell">${getCell("discount")}</td>`);
        if (columnSettings.show_taxable) cells.push(`<td>${getCell("taxable")}</td>`);
        if (columnSettings.show_tax_amount) cells.push(`<td class="number-cell">${getCell("tax_amount")}</td>`);
        if (columnSettings.show_total !== false) cells.push(`<td class="number-cell">${getCell("total")}</td>`);
        
        return `<tr bgcolor="${bg}">${cells.join('')}</tr>`;
    });
}

function buildSummaryHtml(summary, config) {
    const summarySettings = config.summary_settings || {};
    const taxLabel = config.tax_message || "BTW (21%)";
    
    const summaryRows = [];
    if (summarySettings.show_net_price !== false && summary.net) summaryRows.push(["Net Price", summary.net]);
    if (summarySettings.show_tax !== false && summary.tax) summaryRows.push([taxLabel, summary.tax]);
    if (summarySettings.show_total_price !== false && summary.total) summaryRows.push(["Total Price", summary.total]);
    if (summarySettings.show_amount_due !== false && summary.due) summaryRows.push(["Amount Due", summary.due]);
    
    const summaryColspan = Math.max(1, buildHeaders(config).length - 1);
    
    return summaryRows.map(([label, value]) =>
        `<tr bgcolor="#ffffff"><td class="total-label-cell">${escapeHtml(label)}</td>` +
        `<td class="total-number-cell" colspan="${summaryColspan}">${escapeHtml(value)}</td></tr>`
    ).join('');
}

function buildNotesHtml(config, ibanConfig, data) {
    const notesLines = [];
    
    // Bank information
    if (ibanConfig.iban || config.bank?.bic || config.bank?.btw_number) {
        notesLines.push("", "");
        if (ibanConfig.iban) notesLines.push(`IBAN: ${ibanConfig.iban}`);
        if (config.bank?.bic) notesLines.push(`BIC: ${config.bank.bic}`);
        if (config.bank?.btw_number) notesLines.push(`BTW number: ${config.bank.btw_number}`);
        notesLines.push("", "");
    }
    
    // Payment request
    if (config.payment_request) {
        notesLines.push(...config.payment_request.split('\n'));
    } else {
        notesLines.push(
            "We kindly request you to transfer the above-mentioned amount before the due date",
            "to the bank account mentioned above in the name of Stichting Studiereis Astatine in Enschede,",
            "quoting the invoice number."
        );
    }
    
    // Closing
    notesLines.push("", "With kind regards,", "");
    if (config.treasurer?.name) notesLines.push(config.treasurer.name);
    if (config.treasurer?.title) notesLines.push(config.treasurer.title);
    if (config.treasurer?.email) notesLines.push(config.treasurer.email);
    
    return notesLines.map(line => escapeHtml(line)).join('<br />');
}

function generatePageTitle(data) {
    const clientName = (data.client_name_html || "").replace(/<[^>]*>/g, "").trim();
    const invoiceNum = data.invoice_number || "";
    return `Invoice ${invoiceNum} - ${clientName}`;
}

function generateHtmlTemplate({
    pageTitle,
    bannerHtml,
    data,
    showDate,
    showDueDate,
    headers,
    itemRows,
    summaryHtml,
    notesHtml,
    config
}) {
    return `<!DOCTYPE html>
<html dir='auto'>
<head>
<meta http-equiv="content-type" content="text/html; charset=utf-8" />
<title>${escapeHtml(pageTitle)}</title>
<style type="text/css">
/* Modern CSS with html2canvas-pro support */
img {
    width: 100%;
    height: auto;
    display: block;
    margin: 0;
    padding: 0;
    object-fit: contain; /* Supported by html2canvas-pro */
}

/* Modern color functions supported by html2canvas-pro */
:root {
    --primary-color: oklab(0.6 0.1 0.2);
    --text-color: oklch(0.15 0.02 250);
    --border-color: color(display-p3 0.5 0.5 0.5);
    --highlight-bg: lab(95 0 0);
}

@media (prefers-color-scheme: dark) {
    body {
        color: var(--text-color);
        background-color: oklch(0.98 0.01 250);
    }
}

h3 {
    font-family: "Open Sans", sans-serif;
    font-size: 18pt;
    font-weight: bold;
    color: var(--primary-color);
}

a {
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
    font-style: italic;
    color: color(from var(--primary-color) srgb r g b / 0.8);
}

body, p, table, tr, td {
    vertical-align: top;
    font-family: "Open Sans", sans-serif;
    font-size: 13pt;
    color: var(--text-color);
}

tr.alternate-row {
    background: oklch(0.95 0.01 250);
}

tr {
    page-break-inside: avoid !important;
}

html, body {
    height: 100vh;
    margin: 0;
}

td, th {
    border-color: var(--border-color);
}

th.column-heading-left {
    text-align: left;
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
    background: var(--highlight-bg);
}

th.column-heading-center {
    text-align: center;
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
    background: var(--highlight-bg);
}

th.column-heading-right {
    text-align: right;
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
    background: var(--highlight-bg);
}

td.highlight {
    background-color: var(--highlight-bg);
}

td.neg {
    color: oklch(0.6 0.2 30); /* Modern red using OKLCH */
}

td.number-cell, td.total-number-cell {
    text-align: right;
    white-space: nowrap;
}

td.date-cell {
    white-space: nowrap;
}

td.anchor-cell {
    white-space: nowrap;
    font-family: "Open Sans", sans-serif;
    font-size: 13pt;
}

td.number-cell {
    font-family: "Open Sans", sans-serif;
    font-size: 14pt;
}

td.number-header {
    text-align: right;
    font-family: "Open Sans", sans-serif;
    font-size: 12pt;
}

td.text-cell {
    font-family: "Open Sans", sans-serif;
    font-size: 13pt;
}

td.total-number-cell {
    font-family: "Open Sans", sans-serif;
    font-size: 14pt;
    font-weight: bold;
    color: var(--primary-color);
}

td.total-label-cell {
    font-family: "Open Sans", sans-serif;
    font-size: 14pt;
    font-weight: bold;
}

td.centered-label-cell {
    text-align: center;
    font-family: "Open Sans", sans-serif;
    font-size: 14pt;
    font-weight: bold;
}

sub { top: 0.4em; }
sub, sup { vertical-align: baseline; position: relative; top: -0.4em; }

@media print {
    html, body { height: unset; }
}

.div-align-right { float: right; }
.div-align-right .maybe-align-right { text-align: right }

.entries-table * {
    border-width: 1px;
    border-style: solid;
    border-collapse: collapse;
    border-color: var(--border-color);
}

.entries-table > table { width: 100% }
.company-table > table * { padding: 0px; }
.client-table > table * { padding: 0px; }
.invoice-details-table > table * { padding: 0px; text-indent: 0.2em; }
.main-table > table { width: 80%; }

.company-name, .client-name {
    font-size: x-large;
    margin: 0;
    line-height: 1.25;
    color: var(--primary-color);
}

.client-table .client-name { text-align: left; }
.client-table .maybe-align-right { text-align: left; }

.invoice-title {
    font-weight: bold;
    color: var(--primary-color);
    font-size: 1.2em;
}

.invoice-notes {
    margin-top: 0;
    width: 100%;
    color: oklch(0.3 0.01 250);
}
</style>
</head>
<body text="#000000" link="#1c3661" bgcolor="#ffffff" style="margin: 0; padding: 0;">
${bannerHtml ? `<div style="width: 100%; max-width: 1006px; margin: 0; padding: 0; left: 0; right: 0; position: relative;">${bannerHtml}</div>` : ''}
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-left:0; margin-right:0; max-width: 1006px;">
  <tbody>
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