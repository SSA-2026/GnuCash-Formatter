import { STATE } from './state.js';

/**
 * Generate PDF from invoice data using pdfmake
 * This creates PDFs with selectable text
 */
export async function generatePdfFromData(data, config, ibanConfig, filename) {
    return new Promise(async (resolve, reject) => {
        try {
            // Wait for pdfmake to load
            let attempts = 0;
            const maxAttempts = 20;
            
            while (attempts < maxAttempts) {
                if (typeof window.pdfMake !== 'undefined') break;
                attempts++;
                await new Promise(r => setTimeout(r, 200));
            }
            
            if (typeof window.pdfMake === 'undefined') {
                throw new Error('pdfMake library not available. Please refresh the page.');
            }

            // Load banner image if exists
            let bannerDataUrl = null;
            if (config.banner_path && STATE.projectDirectoryHandle) {
                try {
                    let bannerFilename = config.banner_path;
                    if (bannerFilename.startsWith('./')) bannerFilename = bannerFilename.substring(2);
                    if (bannerFilename.startsWith('config/')) bannerFilename = bannerFilename.substring(7);
                    
                    const configHandle = await STATE.projectDirectoryHandle.getDirectoryHandle('config');
                    const fileHandle = await configHandle.getFileHandle(bannerFilename);
                    const file = await fileHandle.getFile();
                    bannerDataUrl = await readFileAsDataURL(file);
                } catch (e) {
                    console.warn("Could not load banner:", e);
                }
            }

            // Build pdfmake document definition
            const docDefinition = buildDocumentDefinition(data, config, ibanConfig, bannerDataUrl);
            
            // Generate PDF
            const pdfDocGenerator = window.pdfMake.createPdf(docDefinition);
            
            pdfDocGenerator.getBlob((blob) => {
                resolve(blob);
            });

        } catch (error) {
            console.error('PDF generation failed:', error);
            reject(error);
        }
    });
}

// Helper to read file as data URL
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Strip HTML tags
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
}

// Build the pdfmake document definition
function buildDocumentDefinition(data, config, ibanConfig, bannerDataUrl) {
    const primaryColor = '#1c3661';
    const textColor = '#333333';
    const mutedColor = '#666666';
    
    const content = [];
    
    // Banner (full width - extends to page edges)
    if (bannerDataUrl) {
        content.push({
            image: bannerDataUrl,
            width: 595, // A4 width in points (210mm)
            margin: [-40, -40, -40, 10] // Negative margins to extend to page edges
        });
    }
    
    // Invoice Title and Dates (same row, two columns)
    const dateSettings = config.date_settings || {};
    const dateStack = [];
    if (dateSettings.show_date !== false && data.date) {
        dateStack.push({ text: `Date: ${data.date}`, alignment: 'right', fontSize: 10, color: textColor });
    }
    if (dateSettings.show_due_date !== false && data.due_date) {
        dateStack.push({ text: `Due Date: ${data.due_date}`, alignment: 'right', fontSize: 10, color: textColor });
    }
    
    content.push({
        columns: [
            {
                width: '*',
                text: `Invoice #${data.invoice_number || ''}`,
                fontSize: 12,
                bold: true,
                color: textColor
            },
            {
                width: 'auto',
                stack: dateStack
            }
        ],
        margin: [0, 10, 0, 15]
    });
    
    // Client and Company info (two columns)
    content.push({
        columns: [
            {
                width: '*',
                stack: [
                    { text: stripHtml(data.client_name_html), style: 'partyName' },
                    { text: stripHtml(data.client_address_html), style: 'partyAddress' }
                ]
            },
            {
                width: '*',
                stack: [
                    { text: stripHtml(data.company_name_html), style: 'partyName', alignment: 'right' },
                    { text: stripHtml(data.company_address_html), style: 'partyAddress', alignment: 'right' }
                ]
            }
        ],
        margin: [0, 0, 0, 20]
    });
    
    // Items table - use auto-detected columns from GnuCash
    const detectedColumns = data.detectedColumns || [];
    const tableHeaders = [];
    const tableWidths = [];
    
    // Number columns that should be right-aligned
    const numberColumns = ['quantity', 'unit_price', 'discount', 'tax_amount', 'total'];
    
    // Build headers from detected columns
    detectedColumns.forEach(col => {
        const isNumber = numberColumns.includes(col.key);
        tableHeaders.push({ 
            text: col.label, 
            style: 'tableHeader',
            alignment: isNumber ? 'right' : 'left'
        });
        // Description column gets flexible width, others auto
        tableWidths.push(col.key === 'description' ? '*' : 'auto');
    });
    
    const tableBody = [tableHeaders];
    
    // Add item rows using detected columns
    if (data.items && data.items.length > 0) {
        data.items.forEach((item, index) => {
            const row = [];
            const fillColor = index === 0 ? '#92a7b6' : (index % 2 === 0 ? '#f5f5f5' : null);
            
            detectedColumns.forEach(col => {
                const isNumber = numberColumns.includes(col.key);
                row.push({ 
                    text: item[col.key] || '', 
                    alignment: isNumber ? 'right' : 'left',
                    fillColor 
                });
            });
            
            tableBody.push(row);
        });
    }
    
    // Add summary rows based on what was detected in the HTML
    const taxLabel = data.summary?.taxLabel || config.tax_message || 'BTW (21%)';
    const colspan = tableHeaders.length - 1;
    
    if (data.summary?.net) {
        tableBody.push([
            { text: 'Net Price', style: 'summaryLabel', colSpan: colspan }, 
            ...Array(colspan - 1).fill({}),
            { text: data.summary.net, style: 'summaryValue', alignment: 'right' }
        ]);
    }
    
    // Tax row - check if should be hidden when zero
    if (data.summary?.tax) {
        const taxValue = data.summary.tax;
        const isZeroTax = /€\s*0[.,]?0*$/.test(taxValue) || taxValue === '€0' || taxValue === '€0.00' || taxValue === '€0,00';
        const shouldHide = config.hide_zero_tax && isZeroTax;
        
        if (!shouldHide) {
            tableBody.push([
                { text: taxLabel, style: 'summaryLabel', colSpan: colspan },
                ...Array(colspan - 1).fill({}),
                { text: taxValue, style: 'summaryValue', alignment: 'right' }
            ]);
        }
    }
    if (data.summary?.total) {
        tableBody.push([
            { text: 'Total Price', style: 'summaryLabel', colSpan: colspan },
            ...Array(colspan - 1).fill({}),
            { text: data.summary.total, style: 'summaryValue', alignment: 'right', bold: true }
        ]);
    }
    if (data.summary?.due) {
        tableBody.push([
            { text: 'Amount Due', style: 'summaryLabel', colSpan: colspan, bold: true },
            ...Array(colspan - 1).fill({}),
            { text: data.summary.due, style: 'summaryValue', alignment: 'right', bold: true, color: primaryColor }
        ]);
    }
    
    content.push({
        table: {
            headerRows: 1,
            widths: tableWidths,
            body: tableBody
        },
        layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#cccccc',
            vLineColor: () => '#cccccc',
            paddingLeft: () => 5,
            paddingRight: () => 5,
            paddingTop: () => 3,
            paddingBottom: () => 3
        },
        margin: [0, 0, 0, 20]
    });
    
    // Notes section
    const notesContent = [];
    
    // Bank info
    if (ibanConfig?.iban) {
        notesContent.push({ text: `IBAN: ${ibanConfig.iban}`, margin: [0, 0, 0, 2] });
    }
    if (config.bank?.bic) {
        notesContent.push({ text: `BIC: ${config.bank.bic}`, margin: [0, 0, 0, 2] });
    }
    if (config.bank?.btw_number) {
        notesContent.push({ text: `BTW number: ${config.bank.btw_number}`, margin: [0, 0, 0, 2] });
    }
    
    if (notesContent.length > 0) {
        notesContent.push({ text: '', margin: [0, 5, 0, 5] });
    }
    
    // Payment request
    if (config.payment_request) {
        notesContent.push({ text: config.payment_request, margin: [0, 0, 0, 10], color: textColor });
    } else {
        notesContent.push({ 
            text: 'We kindly request you to transfer the above-mentioned amount before the due date to the bank account mentioned above, quoting the invoice number.',
            margin: [0, 0, 0, 10],
            color: textColor
        });
    }
    
    // Closing
    notesContent.push({ text: 'With kind regards,', margin: [0, 10, 0, 5], color: textColor });
    if (config.treasurer?.name) {
        notesContent.push({ text: config.treasurer.name, bold: true, color: textColor });
    }
    if (config.treasurer?.title) {
        notesContent.push({ text: config.treasurer.title, color: textColor });
    }
    if (config.treasurer?.email) {
        notesContent.push({ text: config.treasurer.email, color: primaryColor, italics: true });
    }
    
    content.push({
        stack: notesContent,
        color: textColor  // Default black for notes
    });
    
    return {
        content: content,
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 40],
        info: {
            title: `Invoice ${data.invoice_number || ''}`
        },
        styles: {
            invoiceTitle: {
                fontSize: 18,
                bold: true,
                color: primaryColor
            },
            partyName: {
                fontSize: 14,
                bold: true,
                color: primaryColor,
                margin: [0, 0, 0, 3]
            },
            partyAddress: {
                fontSize: 10,
                color: textColor,
                lineHeight: 1.3
            },
            tableHeader: {
                bold: true,
                fontSize: 10,
                color: textColor,
                fillColor: '#e0e0e0'
            },
            summaryLabel: {
                fontSize: 11,
                bold: true
            },
            summaryValue: {
                fontSize: 11
            },
            notes: {
                fontSize: 10,
                color: mutedColor
            }
        },
        defaultStyle: {
            font: 'Roboto',
            fontSize: 10,
            color: textColor
        }
    };
}

// Legacy function for backward compatibility - now calls generatePdfFromData
export async function generatePdfFromHtml(htmlContent, filename) {
    // This function is kept for backward compatibility but should not be used
    // The main.js should call generatePdfFromData directly
    console.warn('generatePdfFromHtml is deprecated, use generatePdfFromData instead');
    throw new Error('Please use generatePdfFromData instead of generatePdfFromHtml');
}