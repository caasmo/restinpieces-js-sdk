import{c as o}from"./chunk-NTKSLLJF.js";function i(){let n=document.getElementById("result"),s=document.getElementById("error");n.textContent="Loading...",s.textContent="",new o({baseURL:"http://localhost:8080"}).listOauth2Providers().then(t=>{n.textContent=JSON.stringify(t,null,2),document.getElementById("result-section").classList.remove("providers-result-section")}).catch(t=>{let e="Error: "+t.message+`
`;e+="Status: "+t.status+`
`,t.response&&(e+=`Response:
`+JSON.stringify(t.response,null,2)),t.url&&(e+=`
URL: `+t.url),s.textContent=e,n.textContent="",console.error(t)})}document.getElementById("get-providers-btn").addEventListener("click",i);
