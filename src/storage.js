import { STATE, DEFAULT_CONFIG, DEFAULT_IBAN_CONFIG } from './state.js';
import { toast, formatBytes } from './utils.js';

// IndexedDB for handle storage
const DB_NAME = 'InvoiceFormatterDB';
const STORE_NAME = 'handles';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME);
        };
    });
}

export async function storeDirectoryHandle(handle) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(handle, 'projectDirectory');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { console.error("DB Error:", e); }
}

export async function getStoredDirectoryHandle() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('projectDirectory');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) { return null; }
}

export async function clearStoredDirectoryHandle() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete('projectDirectory');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { console.error("DB Error:", e); }
}

export function loadConfigFromStorage(updateFolderStatusCallback) {
    try {
        const config = localStorage.getItem('invoice-formatter-config');
        const ibanConfig = localStorage.getItem('invoice-formatter-iban');
        
        STATE.config = config ? JSON.parse(config) : { ...DEFAULT_CONFIG };
        STATE.ibanConfig = ibanConfig ? JSON.parse(ibanConfig) : { ...DEFAULT_IBAN_CONFIG };
        
        if (updateFolderStatusCallback) updateFolderStatusCallback();
        return true;
    } catch (e) {
        console.error('Failed to load config from storage:', e);
        STATE.config = { ...DEFAULT_CONFIG };
        STATE.ibanConfig = { ...DEFAULT_IBAN_CONFIG };
        return false;
    }
}

export function saveConfigToStorage(updateFolderStatusCallback) {
    try {
        localStorage.setItem('invoice-formatter-config', JSON.stringify(STATE.config));
        localStorage.setItem('invoice-formatter-iban', JSON.stringify(STATE.ibanConfig));
        if (updateFolderStatusCallback) updateFolderStatusCallback();
        return true;
    } catch (e) {
        console.error('Failed to save config to storage:', e);
        toast("Failed to save configuration", "bad");
        return false;
    }
}

export async function saveToOutputFolder(content, filename) {
    // Try to save to the project's output directory using File System Access API
    if (STATE.outputDirectoryHandle) {
        try {
            const fileHandle = await STATE.outputDirectoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            console.log(`Saved ${filename} to output folder (${formatBytes(new Blob([content]).size)})`);
            
            // Add to output files list for display
            const fileObj = {
                id: Date.now() + Math.random() + '_' + filename,
                name: filename,
                size: new Blob([content]).size,
                content: content,
                type: 'html',
                savedToFile: true
            };
            
            STATE.outputFiles.push(fileObj);
            return fileObj;
        } catch (error) {
            console.error('Failed to save to output folder:', error);
            toast(`Failed to save ${filename} to output folder: ${error.message}`, "bad");
        }
    }
    
    // Fallback: store in memory if no output directory is available
    const fileObj = {
        id: Date.now() + Math.random() + '_' + filename,
        name: filename,
        size: new Blob([content]).size,
        content: content,
        type: 'html',
        savedToFile: false
    };
    
    STATE.outputFiles.push(fileObj);
    console.log(`Stored ${filename} in output list (${formatBytes(fileObj.size)})`);
    return fileObj;
}

export async function savePdfToOutputFolder(pdfBlob, filename) {
    // Try to save to the project's output directory using File System Access API
    if (STATE.outputDirectoryHandle) {
        try {
            const fileHandle = await STATE.outputDirectoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(pdfBlob);
            await writable.close();
            console.log(`Saved ${filename} to output folder (${formatBytes(pdfBlob.size)})`);
            return true;
        } catch (error) {
            console.error('Failed to save PDF to output folder:', error);
            toast(`Failed to save ${filename} to output folder: ${error.message}`, "bad");
        }
    }
    return false;
}

export async function deleteHtmlFilesFromOutput() {
    // Always remove HTML files from the output files list (UI)
    const initialCount = STATE.outputFiles.length;
    STATE.outputFiles = STATE.outputFiles.filter(f => !f.name.endsWith('.html'));
    const removedFromList = initialCount - STATE.outputFiles.length;
    
    // If we have a directory handle, delete files from disk
    if (STATE.outputDirectoryHandle) {
        try {
            const htmlFilesToDelete = [];
            
            // Find all HTML files in the output directory
            for await (const [name, handle] of STATE.outputDirectoryHandle.entries()) {
                if (name.endsWith('.html')) {
                    htmlFilesToDelete.push(name);
                }
            }
            
            // Delete each HTML file
            for (const filename of htmlFilesToDelete) {
                try {
                    await STATE.outputDirectoryHandle.removeEntry(filename);
                    console.log(`Deleted HTML file from output: ${filename}`);
                } catch (e) {
                    console.warn(`Could not delete ${filename}:`, e);
                }
            }
            
            if (htmlFilesToDelete.length > 0) {
                toast(`Cleaned up ${htmlFilesToDelete.length} HTML file(s) from output`, "good");
            }
        } catch (error) {
            console.error('Failed to delete HTML files from output:', error);
            throw error;
        }
    } else if (removedFromList > 0) {
        console.log(`Removed ${removedFromList} HTML file(s) from output list`);
    }
}