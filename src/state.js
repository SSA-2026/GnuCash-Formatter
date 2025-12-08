export const DEFAULT_CONFIG = {
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

export const DEFAULT_IBAN_CONFIG = {
    iban: ""
};

export const STATE = {
    projectFolder: null,
    projectDirectoryHandle: null,
    outputDirectoryHandle: null,
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