/* IRAI contact page: validate, then open the visitor's email app with the message filled in. Needs js/site.js. */
(function(){
"use strict";
const {data,t,$}=window.IRAI;
const EMAIL=data.email;
const form=$('#contactForm'),done=$('#contactDone'),err=$('#cErr'),topic=$('#cTopic');

/* /contact/?topic=prova preselects a topic (links from the product pages) */
const want=new URLSearchParams(location.search).get('topic');
if(want&&[...topic.options].some(o=>o.value===want))topic.value=want;

const topicLabel=()=>topic.options[topic.selectedIndex].textContent;
function showErr(msg,field){err.textContent=msg;err.hidden=false;if(field)field.focus();}
function contactText(){return [t('contact.mail_name')+': '+$('#cName').value.trim(),t('contact.mail_email')+': '+$('#cEmail').value.trim(),t('contact.mail_org')+': '+$('#cOrg').value.trim(),t('contact.mail_topic')+': '+topicLabel(),'',$('#cBody').value.trim()].join('\n');}
async function copyContact(b){
  try{await navigator.clipboard.writeText(contactText());b.textContent=t('contact.copied');}catch(_){b.textContent=t('contact.copy_failed');}
  setTimeout(()=>{b.textContent=t('contact.copy');},2500);
}
$('#cCopy').addEventListener('click',e=>copyContact(e.currentTarget));
$('#cCopyDone').addEventListener('click',e=>copyContact(e.currentTarget));

/* mailto: URLs past ~2000 chars get cut or refused by some mail clients, so the message is shortened to fit. */
const MAILTO_MAX=1800;
function mailtoUrl(m){
  const subject=t('contact.mail_subject',{topic:m.topic,name:m.name});
  const head=[t('contact.mail_name')+': '+m.name,t('contact.mail_email')+': '+m.email,t('contact.mail_org')+': '+(m.org||'—'),t('contact.mail_topic')+': '+m.topic,'',''].join('\r\n');
  const cut='\r\n\r\n'+t('contact.mail_cut');
  const url=b=>'mailto:'+EMAIL+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(head+b);
  const full=url(m.body);
  if(full.length<=MAILTO_MAX)return {url:full,cut:false};
  const chars=Array.from(m.body);let lo=0,hi=chars.length;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(url(chars.slice(0,mid).join('').trimEnd()+cut).length<=MAILTO_MAX)lo=mid;else hi=mid-1;}
  return {url:url(chars.slice(0,lo).join('').trimEnd()+cut),cut:true};
}
form.addEventListener('submit',e=>{
  e.preventDefault();err.hidden=true;
  const name=$('#cName').value.trim(),email=$('#cEmail').value.trim(),body=$('#cBody').value.trim();
  if(!name)return showErr(t('contact.err_name'),$('#cName'));
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return showErr(t('contact.err_email'),$('#cEmail'));
  if(body.length<10)return showErr(t('contact.err_body'),$('#cBody'));
  const {url,cut}=mailtoUrl({name,email,org:$('#cOrg').value.trim().slice(0,160),topic:topicLabel(),body:body.slice(0,4000)});
  const a=document.createElement('a');a.href=url;a.hidden=true;document.body.append(a);a.click();a.remove();
  $('#cDoneCut').hidden=!cut;
  form.hidden=true;done.hidden=false;done.focus();
});
$('#cAgain').addEventListener('click',()=>{done.hidden=true;form.hidden=false;$('#cSubmit').focus();});
})();
