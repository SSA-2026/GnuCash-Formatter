export const DEFAULT_CONFIG = {
    bank: {
        account_name: "",
        bic: "",
        btw_number: ""
    },
    banner_path: "",
    hide_zero_tax: true,
    payment_request: "We kindly request you to transfer the above-mentioned amount before the due date to the bank account mentioned above, quoting the invoice number.",
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