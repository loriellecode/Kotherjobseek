// Dev harness for browser checks: real server + MOCK job source and MOCK photo service (fictional fixtures; never used by the app itself).
process.env.NODE_ENV='test'; process.env.SCHEDULER_ENABLED='false'; process.env.RESCAN_DEBOUNCE_MS='700'; process.env.INITIAL_PROFILE_FILE=require('path').join(__dirname,'..','..','config','initial-profile.json');
process.env.DATA_DIR=require('fs').mkdtempSync('/tmp/kother-ui-');
const http=require('http');
const day=(n)=>new Date(Date.now()+n*864e5).toISOString();
const J=(id,title,co,city,min,max,desc)=>({id:String(id),title,company:{display_name:co},location:{display_name:city+', California',area:['US','California','San Joaquin County',city]},latitude:null,longitude:null,salary_min:min,salary_max:max,salary_is_predicted:'0',contract_time:'full_time',redirect_url:'https://jobs.example.test/'+id,created:day(-id%9),description:desc,category:{label:'x'}});
const jobs=[
 J(1,'Budget Analyst II','Test County Office of Finance','Stockton',78000,92000,"Prepare budget forecasts and reports. Bachelor's degree in finance or accounting required. 2 years of finance experience required."),
 J(2,'Special Education Teacher','Test Unified School District','Stockton',68000,96000,"Lead a resource classroom. A valid California Education Specialist Instruction Credential is required. Bachelor's degree required."),
 J(3,'Financial Analyst','Test Valley Credit Union','Lodi',72000,88000,"Analyze financial results. Bachelor's degree preferred. 3 years of finance experience required. Financial modeling a plus."),
 J(4,'Operations Manager','Test Logistics Co','Tracy',85000,105000,"Oversee operations. Bachelor's degree required. 4 years of management experience required."),
 J(5,'Assistant Principal','Test Charter Schools','Stockton',105000,125000,"Instructional leadership. Master's degree required. Valid California Administrative Services Credential required. 3 years of education experience."),
 J(6,'Accounts Payable Specialist','Test Foods','Stockton',46000,58000,"Process invoices. High school diploma required. 1 year of accounting experience preferred."),
 J(7,'Business Analyst (Remote)','Test Advisory','',80000,98000,"This is a fully remote position. Analyze business processes. Bachelor's degree required."),
 J(9,'Employment Specialist','Test Workforce Board','Stockton',62000,74000,"Provide job coaching and case management. Bachelor's degree preferred. To apply, email your resume and cover letter to hiring@testworkforce.example.test with the subject line Employment Specialist Application."),
 J(10,'Program Coordinator','Test Community Services','Lodi',60000,70000,"Coordinate programs. Please email your resume to apply. Bachelor's degree required."),
 J(8,'Instructional Aide','Test Unified School District','Stockton',38000,44000,"Assist teachers in a special education classroom. High school diploma required."),
];
http.createServer((q,r)=>{const u=new URL(q.url,'http://x');r.writeHead(200,{'content-type':'application/json'});const pg=Number(u.pathname.split('/').pop());r.end(JSON.stringify({count:jobs.length,results:pg===1?jobs:[]}));}).listen(4101,'127.0.0.1');
const photo=(id)=>({id,url:'https://www.pexels.com/photo/test-'+id+'/',photographer:'Test Photographer',photographer_url:'https://www.pexels.com/@test',alt:'',avg_color:'#9bb',width:1600,height:1067,src:{small:'https://images.pexels.com/photos/'+id+'/s.jpeg',medium:'https://images.pexels.com/photos/'+id+'/m.jpeg',large:'https://images.pexels.com/photos/'+id+'/l.jpeg',large2x:'https://images.pexels.com/photos/'+id+'/l2.jpeg'}});
http.createServer((q,r)=>{r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({photos:[photo(1)]}));}).listen(4102,'127.0.0.1');
process.env.PEXELS_API_KEY='ui';process.env.PEXELS_BASE_URL='http://127.0.0.1:4102/v1';process.env.ADZUNA_APP_ID='ui';process.env.ADZUNA_APP_KEY='ui';process.env.ADZUNA_BASE_URL='http://127.0.0.1:4101/v1/api';
require('../../server/index').start({port:4100,pipeline:{debounceMs:700}}).then(()=>console.log('ready'));
