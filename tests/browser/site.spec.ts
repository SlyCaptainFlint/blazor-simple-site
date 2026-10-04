import {test,expect,type Page} from '@playwright/test';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const photos=Array.from({length:50},(_,i)=>({id:String(1000+i),title:`Photograph ${i+1}`,width:2048,height:1365,
  variants:[320,640,960,1440,1920].map(width=>({width,url:`/api/photos/${1000+i}/${width}.jpg`}))}));
async function fixture(page:Page){
  await page.route('**/api/photos',route=>route.fulfill({json:{limit:50,photos}}));
  await page.route(/\/api\/photos\/\d+\/\d+\.jpg$/,route=>route.fulfill({body:image,contentType:'image/png'}));
}
test.beforeEach(async({page})=>{await fixture(page);});
test('direct routes have titles, navigation state, and no horizontal overflow',async({page})=>{
  for(const [path,title] of [['/','Olga Zinoveva'],['/about','About · Olga Zinoveva'],['/photography','Photography · Olga Zinoveva']]){
    await page.goto(path);await expect(page).toHaveTitle(title);
    await expect(page.locator('nav [aria-current="page"]')).toHaveAttribute('href',path);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await expect(page.locator('.photo-open')).toHaveCount(50);
});
test('navigation/back/forward preserves the same playing background node and request sources',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const requests:string[]=[];page.on('request',r=>{if(r.url().endsWith('.mp4'))requests.push(r.url());});
  await page.goto('/');
  await expect.poll(()=>page.locator('#background-loop').evaluate((v:HTMLVideoElement)=>!v.paused&&v.currentTime>0)).toBe(true);
  await page.evaluate(()=>{(window as any).originalVideo=document.querySelector('#background-loop');(window as any).originalDocument=document;});
  for(let i=0;i<3;i++){
    for(const [label,path] of [['About','/about'],['Photography','/photography'],['Main','/']]){
      await page.getByRole('navigation').getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(path==='/'?'/$':`${path}$`));
      expect(await page.evaluate(()=>document.querySelector('#background-loop')===(window as any).originalVideo&&document===(window as any).originalDocument)).toBe(true);
      expect(await page.locator('#background-loop').evaluate((v:HTMLVideoElement)=>!v.paused)).toBe(true);
    }
  }
  await page.goBack();await expect(page).toHaveTitle('Photography · Olga Zinoveva');
  await page.goForward();await expect(page).toHaveTitle('Olga Zinoveva');
  await expect(page.locator('#main')).toBeFocused();
  expect(new Set(requests.map(url=>new URL(url).pathname)).size).toBe(2);
  expect(errors).toEqual([]);
});
test('accessible lightbox wraps with arrows, traps focus, closes with Escape and restores focus',async({page})=>{
  await page.goto('/photography');const first=page.locator('.photo-open').first();await first.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(page.getByRole('button',{name:'Close photograph',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowLeft');await expect(dialog).toHaveAccessibleName('Photograph 50');
  await page.keyboard.press('ArrowRight');await expect(dialog).toHaveAccessibleName('Photograph 1');
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('dialog')).toHaveAccessibleName('Photograph 2');
  for(let i=0;i<8;i++)await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(first).toBeFocused();
  expect(await page.locator('body').evaluate(el=>el.style.overflow)).toBe('');
});
test('phone resize, failed image and repeated gallery navigation remain usable',async({page})=>{
  await page.setViewportSize({width:320,height:700});await page.goto('/photography');await expect(page.locator('.photo-open')).toHaveCount(50);
  const width=await page.locator('.photo-open').first().evaluate(el=>el.getBoundingClientRect().width);expect(width).toBeGreaterThan(100);
  await page.setViewportSize({width:1200,height:800});await expect.poll(()=>page.locator('.photo-open').first().evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(width);
  await page.route(/\/api\/photos\/1000\/\d+\.jpg$/,route=>route.fulfill({status:502}));
  await page.reload();await expect(page.locator('.photo-open').first()).toHaveClass(/image-failed/);
  await page.locator('.photo-open').first().click();await expect(page.locator('.lightbox-status')).toContainText('could not load');
  await page.getByRole('button',{name:'Next photograph',exact:true}).click();await expect(page.getByRole('dialog')).toHaveAccessibleName('Photograph 2');
  await page.keyboard.press('Escape');
  for(let i=0;i<3;i++){await page.getByRole('link',{name:'About',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);await page.getByRole('link',{name:'Photography',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(1);}
});
test('empty, failure and retry states plus unknown route',async({page})=>{
  await page.route('**/api/photos',route=>route.fulfill({status:503,json:{error:'service_not_configured'}}));
  await page.goto('/photography');await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
  await page.route('**/api/photos',route=>route.fulfill({json:{photos:[]}}));
  await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('status')).toContainText('No public photographs');
  await page.goto('/missing');await expect(page).toHaveTitle('Page not found · Olga Zinoveva');await page.getByRole('link',{name:'Return home'}).click();await expect(page).toHaveTitle('Olga Zinoveva');
});
test('reduced motion loads no video and permits explicit playback',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});const videos:string[]=[];page.on('request',r=>{if(r.url().endsWith('.mp4'))videos.push(r.url());});
  await page.goto('/');await page.getByRole('link',{name:'About',exact:true}).click();expect(videos).toEqual([]);
  await expect(page.getByRole('button',{name:'Play background animation'})).toBeVisible();
  await page.getByRole('button',{name:'Play background animation'}).click();await expect.poll(()=>videos.length).toBeGreaterThan(0);
});
test('leaving a pending gallery cancels its work and leaves no stale dialog',async({page})=>{
  await page.route('**/api/photos',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({json:{photos}}).catch(()=>{});});
  await page.goto('/photography');await page.getByRole('link',{name:'About',exact:true}).click();await page.waitForTimeout(650);
  await expect(page).toHaveTitle('About · Olga Zinoveva');await expect(page.locator('.gallery')).toHaveCount(0);await expect(page.locator('dialog')).toHaveCount(0);
});
test('history restores gallery scroll and route changes clean up an open modal',async({page})=>{
  await page.goto('/photography');await expect(page.locator('.photo-open')).toHaveCount(50);
  await page.evaluate(()=>scrollTo(0,500));await expect.poll(()=>page.evaluate(()=>history.state.site.scroll)).toBe(500);
  await page.evaluate(()=>document.querySelector<HTMLAnchorElement>('nav a[href="/about"]')!.click());
  await expect(page).toHaveTitle('About · Olga Zinoveva');expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.goBack();await expect(page.locator('.photo-open')).toHaveCount(50);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(500);
  await page.locator('.photo-open').first().click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.goForward();await expect(page).toHaveTitle('About · Olga Zinoveva');await expect(page.locator('dialog')).toHaveCount(0);
  expect(await page.locator('body').evaluate(el=>el.style.overflow)).toBe('');
});

test('photos have no corner links and lightbox shows only image and navigation controls',async({page})=>{
  await page.goto('/photography');await expect(page.locator('.photo-open')).toHaveCount(50);
  await expect(page.locator('.gallery a, .photo-source, .gallery-credit')).toHaveCount(0);
  await page.locator('.photo-open').first().click();const dialog=page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Photograph 1');
  await expect(dialog.locator('img')).toHaveAttribute('alt','Photograph 1');
  await expect(dialog.locator('figcaption, a, .lightbox-count, .lightbox-source')).toHaveCount(0);
  await expect(page.locator('.lightbox-status')).toHaveText('');
  await expect(dialog).toHaveText('× ‹ ›', {useInnerText:true});
});
