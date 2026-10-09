/* SAMPLE listings for previewing the design. These are fictional: invented employers,
   no application links. They are flagged `sample: true` and labelled in the UI. */
(function (root) {
  'use strict';
  const KJ = (root.KJ = root.KJ || {});
  const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
  const S = (o) => Object.assign({ sample: true, url: '', arrangement: 'On-site', salaryPeriod: 'year', type: 'Full-time', lastVerified: day(-1), published: day(-6), deadline: day(21) }, o);

  KJ.sampleJobs = () => [
    S({ id: 'sample-budget-analyst', title: 'Budget Analyst II', employer: 'Example County Office of Finance', city: 'Stockton', neighborhood: 'North Stockton', categories: ['Finance'], salaryMin: 78000, salaryMax: 92000,
      summary: 'Prepares budget forecasts, tracks expenditures against appropriations and supports annual budget hearings.', required: ['Budget forecasting', 'Advanced spreadsheet skills'], preferred: ['Public-sector budgeting'], education: { level: 'bachelor', note: 'Accounting, finance or public administration' }, experience: { years: 2, field: 'Finance' } }),
    S({ id: 'sample-sped-teacher', title: 'Special Education Teacher, Mild/Moderate', employer: 'Example Unified School District', city: 'Stockton', neighborhood: 'North Stockton', categories: ['Education', 'Special Education'], salaryMin: 68000, salaryMax: 96000,
      summary: 'Leads a resource classroom, writes and monitors IEPs and coordinates with general-education teachers.', required: ['IEP development'], preferred: ['Bilingual (Spanish)'], education: { level: 'bachelor' }, certifications: [{ name: 'Education Specialist Instruction Credential', required: true }], deadline: day(14) }),
    S({ id: 'sample-program-coordinator', title: 'Student Support Program Coordinator', employer: 'Example Community College', city: 'Stockton', categories: ['Education'], salaryMin: 58000, salaryMax: 70000,
      summary: 'Coordinates tutoring and advising programs, manages program budgets and reports outcomes to grant funders.', required: ['Program coordination'], education: { level: 'bachelor' }, experience: { years: 1, field: 'Education' } }),
    S({ id: 'sample-branch-manager', title: 'Branch Manager', employer: 'Example Valley Credit Union', city: 'Lodi', categories: ['Finance', 'Business'], salaryMin: 72000, salaryMax: 88000,
      summary: 'Runs daily branch operations, coaches member-service staff and meets lending and deposit goals.', required: ['Team leadership', 'Consumer lending'], education: { level: 'bachelor' }, experience: { years: 3, field: 'Finance' }, deadline: day(9) }),
    S({ id: 'sample-ops-manager', title: 'Operations Manager', employer: 'Example Logistics Co.', city: 'Tracy', categories: ['Business'], salaryMin: 85000, salaryMax: 105000,
      summary: 'Oversees warehouse and delivery operations, process improvement and a 40-person team.', required: ['Process improvement'], education: { level: 'bachelor' }, experience: { years: 4, field: 'Business' } }),
    S({ id: 'sample-remote-analyst', title: 'Financial Analyst (Remote)', employer: 'Example Advisory Group', city: '', remote: true, arrangement: 'Remote (California)', categories: ['Finance'], salaryMin: 80000, salaryMax: 98000,
      summary: 'Builds forecasting models and monthly reporting for mid-sized clients.', required: ['Financial modeling'], education: { level: 'bachelor' }, experience: { years: 2, field: 'Finance' } }),
    S({ id: 'sample-assistant-principal', title: 'Assistant Principal', employer: 'Example Charter Schools', city: 'Stockton', categories: ['Education'], salaryMin: 105000, salaryMax: 125000,
      summary: 'Supports instructional leadership, student discipline and teacher evaluation at a K–8 campus.', required: ['Instructional leadership'], education: { level: 'master' }, experience: { years: 3, field: 'Education' }, certifications: [{ name: 'Preliminary Administrative Services Credential', required: true }], deadline: day(30) }),
    S({ id: 'sample-ap-specialist', title: 'Accounts Payable Specialist', employer: 'Example Foods, Inc.', city: 'Stockton', neighborhood: 'North Stockton', categories: ['Finance'], salaryMin: 24, salaryMax: 29, salaryPeriod: 'hour',
      summary: 'Processes vendor invoices, reconciles statements and supports month-end close.', required: ['Invoice processing'], education: { level: 'associate' }, experience: { years: 1, field: 'Finance' } }),
    S({ id: 'sample-instructional-aide', title: 'Instructional Aide, Special Education', employer: 'Example Unified School District', city: 'Stockton', neighborhood: 'North Stockton', type: 'Part-time', categories: ['Education', 'Special Education'], salaryMin: 19, salaryMax: 22, salaryPeriod: 'hour',
      summary: 'Assists students with disabilities in the classroom under a credentialed teacher.', education: { level: 'high school' } }),
    S({ id: 'sample-curriculum-remote', title: 'Curriculum Developer (Remote)', employer: 'Example Learning Co.', city: '', remote: true, arrangement: 'Remote', categories: ['Education'],
      summary: 'Designs standards-aligned lessons for an online learning platform. Pay is not listed in the posting.', required: ['Curriculum design'], education: { level: 'bachelor' } }),
    S({ id: 'sample-grants-manager', title: 'Grants and Budget Manager', employer: 'Example Community Foundation', city: 'Sacramento', arrangement: 'Hybrid', categories: ['Business', 'Finance'], salaryMin: 88000, salaryMax: 102000,
      summary: 'Manages the foundation’s grant budget, compliance reporting and fund accounting.', required: ['Grant compliance'], education: { level: 'bachelor' }, experience: { years: 3, field: 'Finance' } }),
    S({ id: 'sample-ops-analyst', title: 'Business Operations Analyst', employer: 'Example Health System', city: 'Manteca', categories: ['Business'], salaryMin: 74000, salaryMax: 90000,
      summary: 'Analyzes clinic throughput and cost data and recommends operational improvements.', required: ['Data analysis'], education: { level: 'bachelor' }, experience: { years: 2, field: 'Business' } }),
    S({ id: 'sample-school-business-mgr', title: 'School Business Manager', employer: 'Example Unified School District', city: 'Stockton', categories: ['Education', 'Finance'], salaryMin: 95000, salaryMax: 118000,
      summary: 'Leads school-site budgeting, purchasing and compliance with district finance policy.', required: ['School budgeting'], education: { level: 'bachelor' }, experience: { years: 3, field: 'Finance' }, deadline: day(18) }),
    S({ id: 'sample-behavior-specialist', title: 'Behavior Specialist', employer: 'Example Regional Center', city: 'Stockton', categories: ['Special Education'], salaryMin: 62000, salaryMax: 78000,
      summary: 'Designs behavior-support plans and trains families and staff.', required: ['Behavior intervention'], preferred: ['Board certification in behavior analysis'], education: { level: 'master' }, certifications: [{ name: 'Board Certified Behavior Analyst', required: false }] }),
    S({ id: 'sample-closed', title: 'Payroll Clerk', employer: 'Example Staffing Partners', city: 'Stockton', categories: ['Finance'], salaryMin: 45000, salaryMax: 52000,
      summary: 'This sample listing’s deadline has passed, so it is kept out of the feed.', deadline: day(-3) }),
  ];
})(typeof window !== 'undefined' ? window : globalThis);
