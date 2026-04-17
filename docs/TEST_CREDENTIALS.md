# Test Credentials

This document contains test credentials for development and testing purposes. **Credentials come from the seeded test database.** See "Setup Instructions" to run the seed script if needed.

---

## ⚠️ Setup Required

**Before using these credentials, ensure the seed script has been run:**

```bash
npm run seed:chetanawati
npm run validate:chetanawati  # Verify seed was successful
```

Once seeded, the credentials below will be available in the database.

---

## Admin Account

**Currently not pre-seeded.** To create an admin account:
1. Access MongoDB directly or use admin dashboard creation flow
2. Admin creation is restricted (only one admin per tenant typically)

---

## TPO (Training & Placement Officer) Account

| Field | Value |
|-------|-------|
| **Email** | chetanawati@gmail.com |
| **Password** | Demo@123 |
| **Role** | TPO |
| **Full Name** | Chetan Awati |
| **Institution** | School of Engineering and Technology Shivaji University Kolhapur |
| **Access** | TPO Dashboard at `/tpo/dashboard` |

**Test Workflow:**
1. Go to login page
2. Enter email: `chetanawati@gmail.com`
3. Enter password: `Demo@123`
4. Click Login → Dashboard loads

---

## Student Accounts (Sample from Seed)

The seed script creates **200 students** across 5 branches (40 per branch):

### Computer Science and Technology (CST)
- **CST001** through **CST040**
- Email pattern: `cst001@setk-demo.edu` through `cst040@setk-demo.edu`
- Password: `Student@123` (all students)
- CGPA range: 5.9 - 8.8 (varies by index)
- Status: Some have 0 backlogs, some have 1-2

### Sample CST Students

#### Student 1 (High Performer)
| Field | Value |
|-------|-------|
| **Roll Number** | SETK-2026-CST-001 |
| **PRN** | PRN-2026-CST-001 |
| **Name** | Aarav Patil |
| **Email** | cst001@setk-demo.edu |
| **Password** | Student@123 |
| **CGPA** | 8.1+ |
| **Attendance** | 84%+ |
| **Active Backlogs** | 0 |
| **Branch** | Computer Science and Technology |
| **Batch** | 2026 |

#### Student 2 (Mid-Level Performer)
| Field | Value |
|-------|-------|
| **Roll Number** | SETK-2026-CST-011 |
| **PRN** | PRN-2026-CST-011 |
| **Name** | Aditi Jadhav |
| **Email** | cst011@setk-demo.edu |
| **Password** | Student@123 |
| **CGPA** | 6.7 - 7.0 |
| **Attendance** | 72-85% |
| **Active Backlogs** | 0-1 |
| **Branch** | Computer Science and Technology |
| **Batch** | 2026 |

#### Student 3 (Low Performer but Eligible)
| Field | Value |
|-------|-------|
| **Roll Number** | SETK-2026-CST-030 |
| **PRN** | PRN-2026-CST-030 |
| **Name** | Ananya More |
| **Email** | cst030@setk-demo.edu |
| **Password** | Student@123 |
| **CGPA** | 5.9 - 6.5 |
| **Attendance** | 63-75% |
| **Active Backlogs** | 1-2 |
| **Branch** | Computer Science and Technology |
| **Batch** | 2026 |

### Other Branch Students Available

**Food Technology (FT):** `ft001@setk-demo.edu` - `ft040@setk-demo.edu`  
**Civil Engineering (CE):** `ce001@setk-demo.edu` - `ce040@setk-demo.edu`  
**Chemical Engineering (CHE):** `che001@setk-demo.edu` - `che040@setk-demo.edu`  
**Electronics and Telecom (ETC):** `etc001@setk-demo.edu` - `etc040@setk-demo.edu`
## Testing the New Marks Filters

The seeded students have realistic marks data that can be filtered:

**Via TPO Dashboard:**
1. Log in with TPO credentials: `chetanawati@gmail.com` / `Demo@123`
2. Navigate to `/tpo/students`
3. Click "More Filters" to expand advanced filters
4. Try filtering by:
   - **10th Marks**: Min 75 → shows only high 10th achievers
   - **12th Marks**: Min 85 → filters to stronger academic performers
   - **CGPA**: Min 7.0 → isolates higher performers
   - **Backlogs**: Max 0 → shows only backlog-free students

**Example Filter Test:**
- Filter: `CGPA >= 7.0` AND `Backlogs == 0` AND `10th Marks >= 75`
- Expected Result: ~60-80 students from CST/ETC branches
- Action: Click "Download Excel" to export filtered list

---

## Important Notes

⚠️ **Credentials Are Database-Dependent:**
- The test credentials above only exist after running the seed script
- If you get "Invalid credentials", it means the seed hasn't been run
- Database is: `MONGODB_DB_NAME=campusdrive_prod` (from server/.env)

✅ **What's Seeded:**
- 200 students (40 per branch)
- 1 TPO user
- 9+ drives with realistic placement scenarios
- Mock tests and resources
- Student profile data with resume links

🔐 **Security Reminders:**
- These are test credentials for **development only**
- All students have the same base password for testing convenience
- In production, use proper auth methods (OAuth, SSO, etc.)
- Rotate test credentials regularly

---

## Quick Start

### Step 1: Run the Seed Script
```bash
npm run seed:chetanawati
```

### Step 2: Verify It Worked
```bash
npm run validate:chetanawati
```

Expected output:
```
✓ Found tenant: School of Engineering and Technology...
✓ TPO user created: chetanawati@gmail.com
✓ 200 students seeded across 5 branches
✓ 9+ drives created
✓ Control center ready
```

### Step 3: Log In as TPO
1. Navigate to http://localhost:3000 (or your app URL)
2. Click "Login"
3. Email: `chetanawati@gmail.com`
4. Password: `Demo@123`
5. You'll see the TPO dashboard with all 200 students

### Step 4: Test the New Marks Filters
1. Go to `/tpo/students`
2. Open "More Filters"
3. Apply marks filters (10th, 12th, diploma marks ranges)
4. Verify filter chips appear
5. Click "Download Excel" to test export

---

## Location of Seed Script

File: [server/scripts/seed-chetanawati.ts](../server/scripts/seed-chetanawati.ts)

This script:
- Creates a college tenant
- Seeds 200 students with realistic profiles
- Creates TPO user account
- Generates mock tests and resources
- Sets up placement drives

---

**Last Updated:** April 16, 2026  
**Status:** For Development/Testing Only
