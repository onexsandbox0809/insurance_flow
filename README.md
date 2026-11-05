# Insurance flows: data service, quote engine, proposal PDF and dashboard

WhatsApp Flow submissions go into **one Supabase table** (`proposals`), the premium is calculated automatically,
a **proposal PDF** is generated, uploaded media is stored under the proposal number and exposed through **short links**,
and a **dashboard** (login, customer list, detail tabs) shows everything.

```
WhatsApp flows --POST--> /api/flows/{personal|nominee|insured|medical|covers|documents}   (Vercel functions)
                              |  normalise (IST dates DD-MM-YYYY, masking)  ->  proposals table
                              |  premium engine (lib/premium.js)            ->  premium_* columns
                              |  all 5 data flows in                         ->  PDF (lib/pdf.js) -> Supabase Storage -> /p/<code>
                              |  flow 7 media ids -> OneXAura API 1 -> API 2 -> Storage          -> /d/<code>
Dashboard (public/) --Bearer token--> /api/dashboard/*   |   /api/auth/login   |   /d/<code>, /p/<code> redirects
```

## 1. Set up

**Supabase**
1. Create a project. SQL Editor: run `supabase/schema.sql`, then (optional) `supabase/seed.sql`.
   Schema creates 5 tables, the helper functions and a private storage bucket `proposal-docs`.
2. Project settings > API: copy the project URL and the **service_role** key (server only).

**GitHub + Vercel**
1. Push this folder to a new GitHub repository.
2. Vercel > Add New Project > import the repo (framework preset: *Other*, no build command).
3. Add the environment variables below, deploy, then open `https://your-app.vercel.app/api/health`: it must return `"ok": true`.

| Variable | Example | Purpose |
|---|---|---|
| `SUPABASE_URL` | `https://abcd.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Server-side database and storage access |
| `STORAGE_BUCKET` | `proposal-docs` | Private bucket for documents and PDFs |
| `FLOW_API_KEY` | long random string | Your WhatsApp backend sends it as `x-api-key` |
| `JWT_SECRET` | long random string | Signs dashboard login tokens |
| `JWT_TTL_HOURS` | `8` | Login validity |
| `ONEX_BASE_URL` | `https://api.onexaura.com` | OneXAura base URL |
| `ONEX_API_KEY` | your apiKey | Sent as the `apiKey` header to OneXAura |
| `APP_BASE_URL` | `https://your-app.vercel.app` | Builds the short links `/d/xxxx` and `/p/xxxx` |
| `COMPANY_NAME` | `UIIC Health Insurance` | Printed on the PDF |

Dashboard login after seeding: `admin` / `Admin@123` and `viewer` / `Viewer@123`. **Change them.** Add a user:

```sql
insert into app_users (login_id, password_hash, display_name)
values ('ops', extensions.crypt('a-strong-password', extensions.gen_salt('bf')), 'Operations');
```

**Local preview without Supabase:** `node scripts/demo-server.js` (in-memory data, login `admin` / `Admin@123`).
**Tests:** `npm install && npm test`.

## 2. API reference

All flow endpoints: `POST`, header `x-api-key: <FLOW_API_KEY>`, JSON body. Every body needs the customer
`phone_number` (digits, `919217090193`; 10 digit numbers get `91` added). Flow fields may sit at the top level or inside `data`.
Send `proposal_no` to force a specific proposal; otherwise the newest open proposal of that phone is used.

| Flow | Endpoint | Fields |
|---|---|---|
| 1 Personal | `/api/flows/personal` | full_name, dob, gender, marital_status, occupation, pan, aadhaar, e_insurance_no, pin, city, state, village, address, servicing_office, tel_std, tel_home, mobile, email, ckyc_no, contact_consent |
| 2 Nominee | `/api/flows/nominee` | nominee_name, nominee_relation, nominee_address, nominee_contact |
| 3 Insured | `/api/flows/insured` | persons (1 or 2), p1_/p2_ gender, relation, name, dob, aadhaar, sum_insured, height, weight, blood_group, marital_status, dependent, employment, occupation |
| 5 Medical | `/api/flows/medical` | any_condition, p1_diabetes, p1_hypertension, p1_haemolytic_anaemia, p1_epilepsy, p1_renal_stones, p1_asthma, p1_tobacco, p1_alcohol, p1_cigarettes, habit_quantity |
| 6 Covers | `/api/flows/covers` | covers (array), p1_restoration, p1_maternity, p1_daily_cash, p1_daily_cash_amt |
| 7 Documents | `/api/flows/documents` | id_proof, address_proof, age_proof, previous_policy_docs, prepolicy_reports, pan_doc (each an array of `{id, sha256, mime_type, file_name}`) |

Rules applied to every submission: dates become `DD-MM-YYYY`; entry/update times are IST `HH-mm`; **Aadhaar keeps only the last 4 digits**
(`XXXXXXXX5432`); **PAN keeps the first 2 and last 1 character** (`ANXXXXXXXP`); the raw values are never stored or logged.
`any_condition = "No"` fills **No** against all six diseases.

Responses (flows 1 to 6): `ok`, `proposal_no`, `status` (`draft` -> `quoted` -> `completed`), `flows_completed`, `flows_pending`,
`quote` (annual, half_yearly, quarterly, monthly, net, gst, valid_till) and `proposal_pdf_url` once every data flow is in.
Flow 7 processes each media id strictly one at a time (API 1 get URL, API 2 download, upload, short link) and returns one entry per file.

Premium lookup: `GET /api/quote?proposal_no=HP-...` or `?phone_number=919...` (header `x-api-key`; add `&detail=1` for the full breakdown).

Dashboard: `POST /api/auth/login`, `GET /api/dashboard/list?search=&status=&page=&limit=`, `GET /api/dashboard/proposal?proposal_no=`,
`POST /api/dashboard/regenerate-pdf` (all but login need `Authorization: Bearer <token>`). Public redirects: `/d/<code>` (document), `/p/<code>` (proposal PDF).

## 3. Premium logic (`lib/premium.js`)

Per insured person: **base** = age-band rate (for Rs 5 lakh) x sum-insured factor, plus **loadings** for BMI and occupation
(and, for person 1, medical conditions and habits, capped at +75%). Person 2 gets a **10% family discount**.
Policy level: add-ons (restoration 3%, maternity flat for a female aged 21 to 45, daily cash = per-day amount x 1.4 per insured),
minus a **5% digital discount**, = net, plus **18% GST** = annual premium. Half-yearly, quarterly and monthly instalments carry a
2%, 4% and 6% loading. Everything is stored in `premium_*` columns plus the full `premium_breakdown` JSON.

> **Every rate in `lib/premium.js` is an illustrative placeholder.** Replace the tables with your insurer's filed tariff before quoting real customers.

## 4. Things to know

* **OneXAura responses:** the exact JSON of the two media APIs was not available, so `lib/media.js` accepts a URL anywhere in API 1's JSON,
  and API 2 as raw bytes, JSON with base64, or JSON with a file link. If yours differs, change only `findUrl()` and `extractFile()`.
* **Timeouts:** the documents function is allowed 60 s (`vercel.json`). Six documents at two calls each normally fit.
* **Short links** point to a private bucket; every visit creates a 5 minute signed URL, so files are never public.
* Dates and times are stored as text in the requested formats (`DD-MM-YYYY`, `HH-mm`) next to real `timestamptz` columns used for sorting.
* The proposal PDF sample is in `docs/` (`sample-proposal.pdf`, page images).
