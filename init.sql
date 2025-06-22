
CREATE TABLE payslips (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(7) NOT NULL CHECK (employee_id ~ '^ATS0(?!000)\d{3}$'),
    employee_name VARCHAR(50) NOT NULL,
    employee_type VARCHAR(20) NOT NULL CHECK (employee_type IN ('Permanent', 'Contract', 'Temporary')),
    designation VARCHAR(50) NOT NULL,
    month VARCHAR(2) NOT NULL CHECK (month IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12')),
    month_name VARCHAR(20) NOT NULL,
    year VARCHAR(4) NOT NULL CHECK (year LIKE '20%'),
    date_joining DATE NOT NULL,
    location VARCHAR(50) NOT NULL,
    days_in_month INTEGER NOT NULL CHECK (days_in_month >= 28 AND days_in_month <= 31),
    working_days INTEGER NOT NULL CHECK (working_days >= 0 AND working_days <= 31),
    arrear_days INTEGER NOT NULL CHECK (arrear_days >= 0),
    lop INTEGER NOT NULL CHECK (lop >= 0),
    bank_name VARCHAR(50) NOT NULL,
    account_no VARCHAR(18) NOT NULL CHECK (account_no ~ '^\d{8,18}$'),
    pan VARCHAR(10) NOT NULL CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'),
    provident_fund VARCHAR(23) NOT NULL CHECK (provident_fund ~ '^[A-Z]{5}\d{8,18}$'),
    esic VARCHAR(10) NOT NULL CHECK (esic ~ '^\d{10}$'),
    uan VARCHAR(11) NOT NULL CHECK (uan ~ '^1\d{10}$'),
    gross_pay DECIMAL(10,2) NOT NULL,
    total_deductions DECIMAL(10,2) NOT NULL,
    net_pay DECIMAL(10,2) NOT NULL,
    duration VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, month, year)
);


CREATE TABLE earnings (
    id SERIAL PRIMARY KEY,
    payslip_id INTEGER NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    component VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0)
);


CREATE TABLE deductions (
    id SERIAL PRIMARY KEY,
    payslip_id INTEGER NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    component VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0)
);


CREATE INDEX idx_payslips_employee_month_year ON payslips(employee_id, month, year);
CREATE INDEX idx_earnings_payslip_id ON earnings(payslip_id);
CREATE INDEX idx_deductions_payslip_id ON deductions(payslip_id);
