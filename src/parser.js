import { collapseWs } from './utils.js';

export function parseEasyInvoice(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const data = {};

    // Extract invoice number
    const titleDiv = doc.querySelector('.invoice-title');
    if (titleDiv) {
        const match = titleDiv.textContent.match(/Invoice\s*#([A-Za-z0-9_.\-]+)/i);
        data.invoice_number = match ? match[1] : '';
    } else {
        // Fallback regex on full text if DOM structure is unexpected
        const match = doc.body.textContent.match(/Invoice\s*#([A-Za-z0-9_.\-]+)/i);
        data.invoice_number = match ? match[1] : '';
    }

    // Extract dates
    // Look for cells containing "Date:" or "Due Date:"
    const tds = Array.from(doc.querySelectorAll('td'));
    
    data.date = findLabelValue(tds, "Date");
    data.due_date = findLabelValue(tds, "Due Date");

    // Extract client and company info
    data.client_name_html = getInnerHtmlByClass(doc, "client-name");
    data.client_address_html = getInnerHtmlByClass(doc, "client-address");
    data.company_name_html = getInnerHtmlByClass(doc, "company-name");
    data.company_address_html = getInnerHtmlByClass(doc, "company-address");

    // Extract entries table
    const entriesDiv = doc.querySelector('.entries-table');
    if (entriesDiv) {
        const table = entriesDiv.querySelector('table');
        if (table) {
            const { items, summary } = parseEntriesTable(table);
            data.items = items;
            data.summary = summary;
        } else {
             data.items = [];
             data.summary = {};
        }
    } else {
        data.items = [];
        data.summary = {};
    }

    return data;
}

function findLabelValue(tds, labelText) {
    // Find a TD with the label, then get the next TD's text content
    for (let i = 0; i < tds.length; i++) {
        const text = tds[i].textContent.trim();
        // Check if text starts with label (ignoring case and colon)
        const cleanText = text.replace(':', '').trim().toLowerCase();
        if (cleanText === labelText.toLowerCase()) {
            // The value is likely in the next sibling TD
            const nextTd = tds[i].nextElementSibling;
            if (nextTd) {
                return collapseWs(nextTd.textContent);
            }
        }
    }
    return '';
}

function getInnerHtmlByClass(doc, className) {
    const el = doc.querySelector(`.${className}`);
    return el ? el.innerHTML.trim() : '';
}

function parseEntriesTable(table) {
    const items = [];
    const summary = { net: '', tax: '', total: '', due: '' };
    
    // Get all rows in the table (handling potential thead/tbody)
    const rows = Array.from(table.querySelectorAll('tr'));

    for (const row of rows) {
        // Skip if it's a header row
        if (row.querySelector('th')) continue;

        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 0) continue;

        const firstCellText = collapseWs(cells[0].textContent).toLowerCase();

        // Check summary rows
        const labelMap = {
            "net price": "net",
            "tax": "tax",
            "total price": "total",
            "amount due": "due",
        };

        let isSummary = false;
        for (const [label, key] of Object.entries(labelMap)) {
            if (firstCellText.includes(label)) {
                // Find the currency value in the row
                const text = row.textContent;
                const currencyMatch = text.match(/[€\u20AC]\s?[\d.,]+/);
                if (currencyMatch) {
                    summary[key] = currencyMatch[0];
                }
                isSummary = true;
                break;
            }
        }
        if (isSummary) continue;

        // Parse item row
        // Column order assumption from original code:
        // ["date", "description", "action", "quantity", "unit_price", "discount", "taxable", "total"]
        
        const item = {};
        const columnOrder = ["date", "description", "action", "quantity", "unit_price", "discount", "taxable", "total"];
        
        cells.forEach((cell, index) => {
            if (index < columnOrder.length) {
                item[columnOrder[index]] = collapseWs(cell.textContent);
            }
        });

        // Only add if it looks like a valid item row
        if (item.date || item.description) {
            items.push(item);
        }
    }

    return { items, summary };
}