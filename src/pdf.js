export async function generatePdfFromHtml(htmlContent, filename, options = {}) {
    return new Promise(async (resolve, reject) => {
        try {
            // Wait for libraries to load with multiple retries
            let attempts = 0;
            const maxAttempts = 20;
            
            while (attempts < maxAttempts) {
                const jsPdfAvailable = typeof window.jsPDF !== 'undefined' || (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined');
                const html2CanvasAvailable = typeof window.html2canvas !== 'undefined';
                
                if (jsPdfAvailable && html2CanvasAvailable) {
                    break;
                }
                
                attempts++;
                if (attempts % 5 === 0) console.log(`Waiting for PDF libraries... attempt ${attempts}/${maxAttempts}`);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // Resolve jsPDF constructor
            let jsPDFConstructor = null;
            if (typeof window.jsPDF !== 'undefined') {
                jsPDFConstructor = window.jsPDF;
            } else if (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined') {
                jsPDFConstructor = window.jspdf.jsPDF;
            }
            
            const html2CanvasAvailable = typeof window.html2canvas !== 'undefined';
            
            if (!jsPDFConstructor || !html2CanvasAvailable) {
                console.error('PDF Libraries missing. window.jspdf:', window.jspdf, 'window.jsPDF:', window.jsPDF);
                throw new Error(`PDF libraries not available. jsPDF: ${!!jsPDFConstructor}, html2canvas: ${html2CanvasAvailable}. Please refresh the page.`);
            }

            // Create an iframe to render the content in isolation
            // This avoids style contamination and handles full HTML documents correctly
            const iframe = document.createElement('iframe');
            iframe.style.position = 'absolute';
            iframe.style.left = '-9999px';
            iframe.style.width = '1006px';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            const doc = iframe.contentDocument || iframe.contentWindow.document;
            
            // Sanitize HTML content to remove unsupported color functions
            // Also replace any other modern color functions that might cause issues
            let sanitizedHtml = htmlContent
                .replace(/oklch\([^)]+\)/gi, '#000000')
                .replace(/oklab\([^)]+\)/gi, '#000000')
                .replace(/lch\([^)]+\)/gi, '#000000')
                .replace(/lab\([^)]+\)/gi, '#000000');
            
            doc.open();
            doc.write(sanitizedHtml);
            
            // Inject style to force light scheme and override potential oklch sources
            const style = doc.createElement('style');
            style.textContent = `
                :root { color-scheme: light; }
                * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            `;
            if (doc.head) {
                doc.head.appendChild(style);
            } else {
                doc.body.appendChild(style);
            }
            
            doc.close();

            // Wait for images to load
            const images = doc.querySelectorAll('img');
            const imagePromises = Array.from(images).map(img => {
                return new Promise((resolve) => {
                    if (img.complete) {
                        resolve();
                    } else {
                        img.onload = resolve;
                        img.onerror = resolve;
                        setTimeout(resolve, 3000);
                    }
                });
            });

            await Promise.all(imagePromises);
            await new Promise(resolve => setTimeout(resolve, 500)); // Extra wait for rendering

            try {
                // PDF optimization options with defaults
                const pdfOptions = {
                    quality: options.quality || 0.8, // JPEG quality (0.1-1.0)
                    scale: options.scale || 1.5, // Reduced from 2 for smaller files
                    format: options.format || 'jpeg', // Use JPEG for better compression
                    compress: options.compress !== false, // Enable compression by default
                    ...options
                };

                // Use html2canvas-pro to capture the iframe content
                const canvas = await window.html2canvas(doc.body, {
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: false,
                    window: iframe.contentWindow,
                    width: 1006,
                    height: doc.body.scrollHeight,
                    scale: pdfOptions.scale,
                    // Additional optimization options
                    removeContainer: true,
                    imageTimeout: 15000,
                    onclone: (clonedDoc) => {
                        // Optimize images in cloned document
                        const images = clonedDoc.querySelectorAll('img');
                        images.forEach(img => {
                            // Ensure images are properly sized
                            if (img.naturalWidth > 1600) {
                                img.style.maxWidth = '1600px';
                                img.style.height = 'auto';
                            }
                        });
                    }
                });

                // Calculate dimensions to fit A4
                const imgWidth = 210; // A4 width in mm
                const pageHeight = 295; // A4 height in mm
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                let heightLeft = imgHeight;
                let position = 0;

                // Create PDF
                const pdf = new jsPDFConstructor({
                    orientation: 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });

                // Set PDF metadata
                if (filename) {
                    pdf.setProperties({
                        title: filename
                    });
                }

                // Convert canvas to optimized image format
                const imageFormat = pdfOptions.format.toUpperCase();
                const mimeType = imageFormat === 'JPEG' ? 'image/jpeg' : 'image/png';
                
                // Generate optimized image data with actual compression
                let imageData;
                if (imageFormat === 'JPEG') {
                    // When compression is enabled, reduce quality for smaller file size
                    let actualQuality = pdfOptions.quality;
                    if (pdfOptions.compress) {
                        // Reduce quality more aggressively to achieve 60% size reduction
                        actualQuality = Math.max(0.2, pdfOptions.quality * 0.5);
                    }
                    imageData = canvas.toDataURL(mimeType, actualQuality);
                } else {
                    // For PNG, compression doesn't help much, but we can try
                    imageData = canvas.toDataURL(mimeType);
                }

                // Add image to PDF
                pdf.addImage(imageData, imageFormat, 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;

                // Add new pages if content is longer than one page
                while (heightLeft >= 0) {
                    position = heightLeft - imgHeight;
                    pdf.addPage();
                    pdf.addImage(imageData, imageFormat, 0, position, imgWidth, imgHeight);
                    heightLeft -= pageHeight;
                }

                // Remove the iframe
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }

                // Output PDF with compression
                if (pdfOptions.compress) {
                    const pdfBlob = pdf.output('blob');
                    resolve(pdfBlob);
                } else {
                    // jsPDF always compresses by default, but we can note this
                    const pdfBlob = pdf.output('blob');
                    resolve(pdfBlob);
                }

            } catch (canvasError) {
                // Clean up iframe if canvas generation fails
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
                throw canvasError;
            }

        } catch (error) {
            console.error('PDF generation failed:', error);
            reject(error);
        }
    });
}