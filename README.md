# Invoice Formatter - Static Version

A browser-based version of the Invoice Formatter that runs entirely in your web browser without requiring any server setup. This version is designed for private use with folder-based project management.

## Features

- 🌐 **Pure Client-Side**: Runs entirely in your browser using HTML, CSS, and JavaScript
- 📁 **Folder-Based Workflow**: Select a project folder containing input/, output/, and config/ subdirectories
- 🔒 **Privacy-First**: No data leaves your browser, no personal information in defaults
- ⚙️ **Configuration Management**: Automatically loads config.yml and iban.yml from your project folder
- 🖨️ **Print Support**: Generate print-ready invoices using browser's print functionality
- 💾 **Local Storage**: Configuration is saved in your browser's local storage
- 📱 **Responsive Design**: Works on desktop and mobile devices

## How to Use

### 1. Set Up Your Project Folder

Create a project folder with the following structure:

```
your-project/
├── input/          # Place HTML invoice files here
├── output/         # Converted files will appear here
└── config/         # Configuration files
    ├── config.yml  # Main configuration
    └── iban.yml    # IBAN configuration
```

### 2. Open the Application

Simply open `index.html` in your web browser. No installation required!

### 3. Select Your Project Folder

- Click "📁 Select Project Folder" to choose your project folder
- The application will automatically:
  - Load configuration files from `config/`
  - Find HTML files in `input/`
  - Prepare the `output/` directory for converted files

### 4. Configure Your Settings

#### Option A: Edit Configuration Files
- Edit `config/config.yml` and `config/iban.yml` in your favorite text editor
- The application will automatically reload changes when you re-select the folder

#### Option B: Use the Built-in Editor
- Click "⚙️ Edit Config" to open the configuration editor
- Modify settings in the different tabs (General, Bank, Dates, Columns, Summary)
- Click "💾 Save" to store the configuration in your browser

### 5. Convert Invoices

- Click "⚡ Convert All" to process all files in your input folder
- Or select specific files and click "✓ Convert Selected"
- Choose options like "📄 Keep improved HTML" if desired

### 6. View Results

- Preview converted invoices with "👁️ Preview"
- Print invoices directly with "🖨️ Print"
- Converted files are automatically available in your output folder

## Configuration Options

### General Settings
- **Banner Path**: Path to banner image (relative to invoice files)
- **Treasurer Info**: Name, email, and title (all empty by default for privacy)
- **Payment Request**: Custom payment instructions
- **Tax Message**: Tax label (default: "BTW (21%)")
- **Hide Empty Fields**: Remove empty cells from invoice tables

### Bank Settings
- **BIC**: Bank identifier code (empty by default)
- **BTW Number**: VAT number (empty by default)
- **Account Name**: Bank account holder name (empty by default)
- **IBAN**: Bank account number (empty by default)

### Date Settings
- **Show Date/Due Date**: Toggle date display
- **Date Formats**: Customize date display formats

### Column Settings
- Configure which columns to show in the invoice table:
  - Date, Description, Action, Quantity, Price, Discount, Taxable, Tax Amount, Total

### Summary Settings
- Configure which summary rows to show:
  - Net Price, Tax, Total Price, Amount Due

## Project Structure

Your project folder should be organized as:

```
your-project/
├── input/                 # HTML invoice files from GnuCash
│   ├── invoice1.html
│   └── invoice2.html
├── output/                # Converted files (auto-generated)
│   ├── Invoice-001-Client-improved.html
│   └── Invoice-002-Client-improved.html
└── config/                # Configuration files
    ├── config.yml         # Main configuration
    └── iban.yml           # IBAN configuration
```

## Example Configuration Files

### config.yml
```yaml
# Invoice Formatter Configuration
bank:
  account_name: "Your Organization"
  bic: "YOURBIC"
  btw_number: "Your VAT number"

banner_path: ""

column_settings:
  show_action: false
  show_date: true
  show_description: true
  show_discount: false
  show_price: true
  show_quantity: true
  show_tax_amount: false
  show_taxable: false
  show_total: true

date_settings:
  date_format: "%d/%m/%Y"
  due_date_format: "%d/%m/%Y"
  show_date: false
  show_due_date: true

hide_empty_fields: false

payment_request: |
  We kindly request you to transfer the above-mentioned amount before the due date to the bank account mentioned above, quoting the invoice number.

summary_settings:
  show_amount_due: true
  show_net_price: false
  show_tax: true
  show_total_price: true

tax_message: "BTW (21%)"

treasurer:
  email: "treasurer@example.com"
  name: "Your Name"
  title: "Treasurer"
```

### iban.yml
```yaml
# IBAN Configuration
iban: "Your IBAN here"
```

## Browser Compatibility

This application works in all modern browsers that support:
- File API with directory selection
- Local Storage
- ES6 JavaScript
- CSS Grid and Flexbox

Tested in:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Security & Privacy

- **No Server Required**: All processing happens in your browser
- **No Data Transmission**: Your files never leave your computer
- **Local Storage Only**: Configuration is stored locally in your browser
- **No Personal Information**: Default configuration contains no personal data
- **No Tracking**: No analytics or tracking scripts

## Differences from Server Version

### What's the Same
- Invoice parsing logic
- HTML generation
- Configuration options
- User interface design

### What's Different
- **PDF Generation**: Uses browser's print functionality instead of Playwright
- **File Management**: Folder-based workflow instead of individual file selection
- **Configuration**: Loaded from project folder instead of server
- **Privacy**: No personal information in defaults
- **No Server Dependencies**: Completely self-contained

## Troubleshooting

### Folder Selection Not Working
- Ensure your browser supports directory selection (Chrome, Firefox, Edge)
- Try selecting the folder again
- Check browser console for any error messages

### Files Not Converting
- Ensure files are valid HTML exports from GnuCash Easy Invoice
- Check that files are in the `input/` subdirectory of your project folder
- Try enabling debug mode for more information

### Configuration Not Loading
- Ensure `config/config.yml` and `config/iban.yml` exist in your project folder
- Check YAML syntax in your configuration files
- Try re-selecting the project folder

### Print Issues
- Ensure your browser allows pop-ups for print functionality
- Check print preview to verify layout
- Adjust print margins in browser print settings

## Development

To modify the static version:

1. Edit `index.html` for UI changes
2. Edit `app.js` for functionality changes
3. Test changes by opening `index.html` in a browser
4. No build process required - just save and refresh

## License

This static version maintains the same license as the original Invoice Formatter project.