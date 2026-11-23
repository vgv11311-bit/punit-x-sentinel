(() => {
    const config = document.querySelector('script[data-report-session]');
    const key = `sentinel.report.window.${config.dataset.user}`;
    const reportsUrl = config.dataset.reportsUrl;
    const read = () => { try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; } };
    const forget = () => { try { sessionStorage.removeItem(key); } catch (_) {} };
    const csrf = () => document.querySelector('meta[name="csrf-token"]').content;
    let loading = false, downloaded = false, internalNavigation = false;

    async function openReports() {
        if (!read() || loading || location.pathname !== new URL(reportsUrl).pathname) return;
        loading = true;
        try {
            const result = await fetch(location.href, {headers:{'X-Report-Window':read()},cache:'no-store'});
            if (!result.ok || result.redirected) throw Error('Please sign in again to open reports.');
            const page = new DOMParser().parseFromString(await result.text(), 'text/html');
            const body = page.querySelector('.page-wrap');
            if (!body || body.querySelector('[data-report-unlock]')) { forget(); return; }
            document.querySelector('.page-wrap').innerHTML = body.innerHTML;
            const picker=document.querySelector('[data-column-picker]');
            if(picker){let dragged;picker.querySelectorAll('.column-item').forEach(item=>{item.addEventListener('dragstart',()=>{dragged=item;item.classList.add('dragging')});item.addEventListener('dragend',()=>{item.classList.remove('dragging');dragged=null});item.addEventListener('dragover',event=>{if(!dragged)return;event.preventDefault();const box=item.getBoundingClientRect();picker.insertBefore(dragged,event.clientY<box.top+box.height/2?item:item.nextSibling)})})}
            const pending = body.querySelector('[data-pending-report-url]');
            if (pending && !downloaded) {
                downloaded = true;
                const form = document.createElement('form');
                form.method = 'POST'; form.action = pending.dataset.pendingReportUrl;
                form.dataset.reportDownload = '';
                const input = document.createElement('input'); input.type='hidden'; input.name='_token'; input.value=csrf(); form.append(input);
                form.hidden=true; document.body.append(form); form.requestSubmit();
            }
        } catch (error) {
            const message = document.getElementById('report-unlock-error'); if (message) message.textContent=error.message;
        } finally { loading=false; }
    }
    document.addEventListener('submit', async event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (form.matches('[data-report-unlock]')) {
            event.preventDefault();
            const button=form.querySelector('button[type="submit"]'); if(button.disabled)return; button.disabled=true;
            const message=document.getElementById('report-unlock-error'); message.textContent='';
            try {
                const result=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'},cache:'no-store'});
                const data=await result.json();
                if(!result.ok) throw Error(data.errors?.password?.[0] || data.message || 'Unable to unlock reports.');
                if(typeof data.token!=='string' || data.token.length!==64) throw Error('Invalid report session.');
                sessionStorage.setItem(key,data.token); form.querySelector('[name="password"]').value='';
                await openReports();
            } catch(error) { message.textContent=error.message; }
            finally { button.disabled=false; }
            return;
        }
        const url=new URL(form.action,location.href);
        if(url.origin===location.origin && (url.pathname.endsWith('/reports/preview') || url.pathname.endsWith('/reports/pdf') || /\/weighments\/\d+\/pdf$/.test(url.pathname))) {
            const token=read();
            if(!token) { event.preventDefault(); const next=new URL(reportsUrl); const id=url.pathname.match(/\/weighments\/(\d+)\/pdf$/)?.[1];if(id)next.searchParams.set('download',id);internalNavigation=true;location.assign(next.href);return; }
            let input=form.querySelector('[name="_report_window_token"]');
            if(!input){input=document.createElement('input');input.type='hidden';input.name='_report_window_token';form.append(input);}input.value=token;
        }
        if(url.pathname.endsWith('/logout')) forget();
        if(url.origin===location.origin && !form.matches('[data-report-download]') && !url.pathname.endsWith('/reports/pdf') && !/\/weighments\/\d+\/pdf$/.test(url.pathname)) internalNavigation=true;
    });
    document.addEventListener('click', event => {
        const link=event.target.closest('a[href]');
        if(!link || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || (link.target && link.target!=='_self') || link.hasAttribute('download')) return;
        const target=new URL(link.href,location.href);
        if(target.origin===location.origin && (target.pathname!==location.pathname || target.search!==location.search)) internalNavigation=true;
    });
    window.addEventListener('pagehide', () => {
        if(internalNavigation || !read()) return;
        const data=new FormData();data.set('_token',csrf());data.set('_report_window_token',read());
        forget();
        if(navigator.sendBeacon) navigator.sendBeacon(new URL('/reports/lock',location.origin).href,data);
    });
    window.addEventListener('pageshow', event => {
        internalNavigation=false;
        if(event.persisted && !read() && location.pathname.startsWith('/reports')) {document.querySelector('.page-wrap').hidden=true;location.replace(reportsUrl);}
    });
    openReports();
})();
