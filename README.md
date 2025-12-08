# GnuCash Invoice Formatter

A browser-based tool to format and improve GnuCash invoice exports. Runs entirely in your browser with no server required.

## Features

- 🌐 Pure client-side - works entirely in your browser
- 📁 Folder-based workflow for organizing invoices
- 🔒 Privacy-first - no data leaves your computer
- ⚙️ Configurable invoices with custom banners and settings
- 🖨️ Print-ready invoice generation

## Quick Start

1. Create a project folder with this structure:
   ```
   your-project/
   ├── input/     # Place GnuCash HTML exports here
   ├── output/    # Formatted invoices appear here
   └── config/    # Configuration files
   ```

2. Open `index.html` in your browser

3. Click "Open Project" and select your project folder

4. Configure settings (optional) and convert invoices

## Configuration

Create `config/config.yml` in your project folder:

```yaml
banner_path: "banner.png"  # Path to banner image
tax_message: "BTW (21%)"
payment_request: |
  Please transfer the amount before the due date.

treasurer:
  name: "Your Name"
  email: "your@email.com"
  title: "Treasurer"

bank:
  iban: "Your IBAN"
  bic: "Your BIC"
  btw_number: "Your VAT number"
```

Create `config/iban.yml`:
```yaml
iban: "Your IBAN here"
```

## Usage

1. Add HTML invoice files to the `input/` folder
2. Select files and click "Convert Selected" or "Convert All"
3. Preview and print the formatted invoices
4. Find converted files in the `output/` folder

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge) that support File API.

## Privacy

- No server required
- No data transmission
- All processing happens locally
- No tracking or analytics

## License

Same license as the original project.