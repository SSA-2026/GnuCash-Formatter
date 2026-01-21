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
        const match = doc.body.textContent.match(/Invoice\s*#([A-Za-z0-9_.\-]+)/i);
        data.invoice_number = match ? match[1] : '';
    }

    // Extract dates
    const tds = Array.from(doc.querySelectorAll('td'));
    data.date = findLabelValue(tds, "Date");
    data.due_date = findLabelValue(tds, "Due Date");

    // Extract client and company info
    data.client_name_html = getInnerHtmlByClass(doc, "client-name");
    data.client_address_html = getInnerHtmlByClass(doc, "client-address");
    data.client_id = getTextByClass(doc, "client-id");
    data.company_name_html = getInnerHtmlByClass(doc, "company-name");
    data.company_address_html = getInnerHtmlByClass(doc, "company-address");

    // Extract invoice notes
    const notesElements = doc.querySelectorAll('.invoice-notes');
    data.invoice_notes = Array.from(notesElements)
        .map(el => el.textContent.trim())
        .filter(text => text.length > 0)
        .join('\n');

    // Extract payable to
    data.payable_to = getTextByClass(doc, "invoice-footer-payable-to");

    // Extract entries table with auto-detected columns
    const entriesDiv = doc.querySelector('.entries-table');
    if (entriesDiv) {
        const table = entriesDiv.querySelector('table');
        if (table) {
            // Detect columns from headers
            const detectedColumns = detectTableColumns(table);
            data.detectedColumns = detectedColumns;
            
            // Parse items using detected columns
            const { items, summary } = parseEntriesTable(table, detectedColumns);
            data.items = items;
            data.summary = summary;
        } else {
            data.detectedColumns = [];
            data.items = [];
            data.summary = {};
        }
    } else {
        data.detectedColumns = [];
        data.items = [];
        data.summary = {};
    }

    // Detect which display options are present
    data.displayOptions = {
        hasDueDate: !!data.due_date,
        hasClientId: !!data.client_id,
        hasNotes: !!data.invoice_notes,
        hasPayableTo: !!data.payable_to,
        hasNetPrice: !!data.summary?.net,
        hasTax: !!data.summary?.tax,
        hasTotalPrice: !!data.summary?.total,
        hasAmountDue: !!data.summary?.due
    };

    return data;
}

// Detect table columns from header row
function detectTableColumns(table) {
    const headers = table.querySelectorAll('th');
    const columns = [];
    
    // Map header text to column keys
    const headerMap = {
        'date': 'date',
        'description': 'description',
        'action': 'action',
        'quantity': 'quantity',
        'unit price': 'unit_price',
        'price': 'unit_price',
        'discount': 'discount',
        'taxable': 'taxable',
        'tax amount': 'tax_amount',
        'total': 'total'
    };
    
    headers.forEach(header => {
        const text = header.textContent.trim().toLowerCase();
        const key = headerMap[text];
        if (key) {
            columns.push({
                key: key,
                label: header.textContent.trim()
            });
        }
    });
    
    return columns;
}

function findLabelValue(tds, labelText) {
    for (let i = 0; i < tds.length; i++) {
        const text = tds[i].textContent.trim();
        const cleanText = text.replace(':', '').trim().toLowerCase();
        if (cleanText === labelText.toLowerCase()) {
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

function getTextByClass(doc, className) {
    const el = doc.querySelector(`.${className}`);
    return el ? el.textContent.trim() : '';
}

function parseEntriesTable(table, detectedColumns) {
    const items = [];
    const summary = { net: '', tax: '', taxLabel: '', total: '', due: '' };
    
    const rows = Array.from(table.querySelectorAll('tr'));

    for (const row of rows) {
        // Skip header rows
        if (row.querySelector('th')) continue;

        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 0) continue;

        const firstCellText = collapseWs(cells[0].textContent).toLowerCase();

        // Check summary rows
        const labelMap = {
            "net price": "net",
            "subtotal": "net",
            "tax": "tax",
            "btw": "tax",
            "total price": "total",
            "amount due": "due",
        };

        let isSummary = false;
        for (const [label, key] of Object.entries(labelMap)) {
            if (firstCellText.includes(label)) {
                // Get the currency value
                const text = row.textContent;
                const currencyMatch = text.match(/[€\u20AC]\s?[\d.,]+/);
                if (currencyMatch) {
                    summary[key] = currencyMatch[0];
                    // Store original tax label if it's a tax row
                    if (key === 'tax') {
                        summary.taxLabel = cells[0].textContent.trim();
                    }
                }
                isSummary = true;
                break;
            }
        }
        if (isSummary) continue;

        // Parse item row using detected columns
        const item = {};
        
        // Use detected columns to map values
        cells.forEach((cell, index) => {
            if (index < detectedColumns.length) {
                const column = detectedColumns[index];
                item[column.key] = collapseWs(cell.textContent);
            }
        });

        // Only add if it has meaningful content
        if (item.date || item.description) {
            items.push(item);
        }
    }

    return { items, summary };
}