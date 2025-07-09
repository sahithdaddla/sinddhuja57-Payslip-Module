const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3101;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// PostgreSQL database connection
const pool = new Pool({
    user: 'postgres', // Replace with your PostgreSQL username
    host: 'postgres',
    database: 'payslips_db',
    password: 'admin123', // Replace with your PostgreSQL password
    port: 5432,
});

// Test database connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.stack);
        process.exit(1);
    }
    console.log('Connected to PostgreSQL database');
    release();
});

// Helper function to calculate duration
const calculateDuration = (joiningDate, currentYear, currentMonth) => {
    try {
        const joinDate = new Date(joiningDate);
        if (isNaN(joinDate.getTime())) throw new Error('Invalid joining date');
        const currentDate = new Date(`${currentYear}-${currentMonth}-01`);
        const diffTime = Math.abs(currentDate - joinDate);
        const diffYears = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 365));
        const diffMonths = Math.floor((diffTime % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
        return `${diffYears} Year${diffYears !== 1 ? 's' : ''} ${diffMonths} Month${diffMonths !== 1 ? 's' : ''}`;
    } catch (error) {
        console.error('Error calculating duration:', error.message);
        return 'N/A';
    }
};

// Input validation helper
const validatePayslipData = (data) => {
    const requiredFields = [
        'employeeName', 'employeeType', 'employeeId', 'designation', 'month', 'monthName', 'year',
        'dateJoining', 'location', 'daysInMonth', 'workingDays', 'arrearDays', 'lop',
        'bankName', 'accountNo', 'pan', 'providentFund', 'esic', 'uan', 'earnings', 'deductions'
    ];

    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            return { valid: false, error: `Missing required field: ${field}` };
        }
    }

    // Validate formats
    if (!data.employeeId.match(/^ATS0(?!000)\d{3}$/)) {
        return { valid: false, error: 'Invalid employeeId format (must be ATS0XXX, XXX from 001-999)' };
    }
    if (!['Permanent', 'Contract', 'Temporary'].includes(data.employeeType)) {
        return { valid: false, error: 'Invalid employeeType (must be Permanent, Contract, or Temporary)' };
    }
    if (!data.month.match(/^(0[1-9]|1[0-2])$/)) {
        return { valid: false, error: 'Invalid month (must be 01-12)' };
    }
    if (!data.year.match(/^20\d{2}$/)) {
        return { valid: false, error: 'Invalid year (must be 20XX)' };
    }
    if (!data.pan.match(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)) {
        return { valid: false, error: 'Invalid PAN format' };
    }
    if (!data.accountNo.match(/^\d{8,18}$/)) {
        return { valid: false, error: 'Invalid account number (8-18 digits)' };
    }
    if (!data.providentFund.match(/^[A-Z]{5}\d{8,18}$/)) {
        return { valid: false, error: 'Invalid provident fund number format' };
    }
    if (!data.esic.match(/^\d{10}$/)) {
        return { valid: false, error: 'Invalid ESIC number (10 digits)' };
    }
    if (!data.uan.match(/^1\d{10}$/)) {
        return { valid: false, error: 'Invalid UAN number (starts with 1, 11 digits)' };
    }
    if (!Array.isArray(data.earnings) || data.earnings.length === 0) {
        return { valid: false, error: 'Earnings must be a non-empty array' };
    }
    if (!Array.isArray(data.deductions) || data.deductions.length === 0) {
        return { valid: false, error: 'Deductions must be a non-empty array' };
    }

    // Validate numeric fields
    const numericFields = ['daysInMonth', 'workingDays', 'arrearDays', 'lop'];
    for (const field of numericFields) {
        if (isNaN(Number(data[field])) || Number(data[field]) < 0) {
            return { valid: false, error: `Invalid ${field} (must be a non-negative number)` };
        }
    }
    if (Number(data.daysInMonth) < 28 || Number(data.daysInMonth) > 31) {
        return { valid: false, error: 'Days in month must be between 28 and 31' };
    }
    if (Number(data.workingDays) > Number(data.daysInMonth)) {
        return { valid: false, error: 'Working days cannot exceed days in month' };
    }

    // Validate earnings and deductions
    for (const earning of data.earnings) {
        if (!earning.component || isNaN(Number(earning.amount)) || Number(earning.amount) <= 0) {
            return { valid: false, error: 'Invalid earning entry (must have component and positive amount)' };
        }
    }
    for (const deduction of data.deductions) {
        if (!deduction.component || isNaN(Number(deduction.amount)) || Number(deduction.amount) < 0) {
            return { valid: false, error: 'Invalid deduction entry (must have component and non-negative amount)' };
        }
    }

    return { valid: true };
};

// API to generate payslip (HR side)
app.post('/api/payslips', async (req, res) => {
    try {
        const data = req.body;

        // Validate input data
        const validation = validatePayslipData(data);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const {
            employeeName, employeeType, employeeId, designation, month, monthName, year,
            dateJoining, location, daysInMonth, workingDays, arrearDays, lop,
            bankName, accountNo, pan, providentFund, esic, uan,
            earnings, deductions
        } = data;

        // Calculate totals
        const grossPay = earnings.reduce((sum, earning) => sum + Number(earning.amount), 0);
        const totalDeductions = deductions.reduce((sum, deduction) => sum + Number(deduction.amount), 0);
        const netPay = grossPay - totalDeductions;

        // Calculate duration
        const duration = calculateDuration(dateJoining, year, month);

        // Start transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if payslip exists
            const existingPayslip = await client.query(
                'SELECT id FROM payslips WHERE employee_id = $1 AND month = $2 AND year = $3',
                [employeeId, month, year]
            );

            let payslipId;
            if (existingPayslip.rows.length > 0) {
                // Update existing payslip
                const updateResult = await client.query(
                    `UPDATE payslips SET
                        employee_name = $1,
                        employee_type = $2,
                        designation = $3,
                        month_name = $4,
                        date_joining = $5,
                        location = $6,
                        days_in_month = $7,
                        working_days = $8,
                        arrear_days = $9,
                        lop = $10,
                        bank_name = $11,
                        account_no = $12,
                        pan = $13,
                        provident_fund = $14,
                        esic = $15,
                        uan = $16,
                        gross_pay = $17,
                        total_deductions = $18,
                        net_pay = $19,
                        duration = $20,
                        created_at = CURRENT_TIMESTAMP
                    WHERE employee_id = $21 AND month = $22 AND year = $23
                    RETURNING id`,
                    [
                        employeeName, employeeType, designation, monthName, dateJoining,
                        location, daysInMonth, workingDays, arrearDays, lop,
                        bankName, accountNo, pan, providentFund, esic, uan,
                        grossPay, totalDeductions, netPay, duration,
                        employeeId, month, year
                    ]
                );
                payslipId = updateResult.rows[0].id;

                // Delete existing earnings and deductions
                await client.query('DELETE FROM earnings WHERE payslip_id = $1', [payslipId]);
                await client.query('DELETE FROM deductions WHERE payslip_id = $1', [payslipId]);
            } else {
                // Insert new payslip
                const insertResult = await client.query(
                    `INSERT INTO payslips (
                        employee_id, employee_name, employee_type, designation, month, month_name, year,
                        date_joining, location, days_in_month, working_days, arrear_days, lop,
                        bank_name, account_no, pan, provident_fund, esic, uan, gross_pay,
                        total_deductions, net_pay, duration
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                    RETURNING id`,
                    [
                        employeeId, employeeName, employeeType, designation, month, monthName, year,
                        dateJoining, location, daysInMonth, workingDays, arrearDays, lop,
                        bankName, accountNo, pan, providentFund, esic, uan, grossPay,
                        totalDeductions, netPay, duration
                    ]
                );
                payslipId = insertResult.rows[0].id;
            }

            // Insert earnings
            for (const earning of earnings) {
                await client.query(
                    'INSERT INTO earnings (payslip_id, component, amount) VALUES ($1, $2, $3)',
                    [payslipId, earning.component, Number(earning.amount)]
                );
            }

            // Insert deductions
            for (const deduction of deductions) {
                await client.query(
                    'INSERT INTO deductions (payslip_id, component, amount) VALUES ($1, $2, $3)',
                    [payslipId, deduction.component, Number(deduction.amount)]
                );
            }

            await client.query('COMMIT');
            res.status(200).json({ message: 'Payslip generated successfully', payslipId });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error generating payslip:', {
            message: error.message,
            stack: error.stack,
            requestBody: req.body
        });
        if (error.code === '23505') {
            res.status(400).json({ error: 'Duplicate payslip for employee, month, and year' });
        } else if (error.code === '23503') {
            res.status(400).json({ error: 'Foreign key constraint violation' });
        } else if (error.code === '23514') {
            res.status(400).json({ error: 'Check constraint violation (e.g., invalid format or value)' });
        } else {
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
});

// API to fetch payslip (Employee side)
app.get('/api/payslips/:employeeId/:month/:year', async (req, res) => {
    try {
        const { employeeId, month, year } = req.params;

        // Validate parameters
        if (!employeeId.match(/^ATS0(?!000)\d{3}$/)) {
            return res.status(400).json({ error: 'Invalid employeeId format' });
        }
        if (!month.match(/^(0[1-9]|1[0-2])$/)) {
            return res.status(400).json({ error: 'Invalid month (must be 01-12)' });
        }
        if (!year.match(/^20\d{2}$/)) {
            return res.status(400).json({ error: 'Invalid year (must be 20XX)' });
        }

        // Fetch payslip
        const payslipResult = await pool.query(
            `SELECT * FROM payslips 
            WHERE employee_id = $1 AND month = $2 AND year = $3`,
            [employeeId, month, year]
        );

        if (payslipResult.rows.length === 0) {
            return res.status(404).json({ error: 'Payslip not found' });
        }

        const payslip = payslipResult.rows[0];

        // Fetch earnings
        const earningsResult = await pool.query(
            'SELECT component, amount FROM earnings WHERE payslip_id = $1',
            [payslip.id]
        );

        // Fetch deductions
        const deductionsResult = await pool.query(
            'SELECT component, amount FROM deductions WHERE payslip_id = $1',
            [payslip.id]
        );

        // Format response
        const response = {
            employeeId: payslip.employee_id,
            employeeName: payslip.employee_name,
            employeeType: payslip.employee_type,
            designation: payslip.designation,
            month: payslip.month,
            monthName: payslip.month_name,
            year: payslip.year,
            monthYearFormatted: `${payslip.month_name} ${payslip.year}`,
            dateJoining: payslip.date_joining,
            location: payslip.location,
            daysInMonth: payslip.days_in_month,
            workingDays: payslip.working_days,
            arrearDays: payslip.arrear_days,
            lop: payslip.lop,
            bankName: payslip.bank_name,
            accountNo: payslip.account_no,
            pan: payslip.pan,
            providentFund: payslip.provident_fund,
            esic: payslip.esic,
            uan: payslip.uan,
            grossPay: payslip.gross_pay,
            totalDeductions: payslip.total_deductions,
            netPay: payslip.net_pay,
            duration: payslip.duration,
            earnings: earningsResult.rows,
            deductions: deductionsResult.rows
        };

        res.status(200).json(response);
    } catch (error) {
        console.error('Error fetching payslip:', {
            message: error.message,
            stack: error.stack,
            params: req.params
        });
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', {
        message: err.message,
        stack: err.stack,
        path: req.path
    });
    res.status(500).json({ error: 'Unexpected server error', details: err.message });
});

app.listen(port, () => {
    console.log(`Server running at http://16.171.206.159:${port}`);
});