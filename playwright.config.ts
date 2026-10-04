import {defineConfig, devices} from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',
  fullyParallel:true,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI ? 1 : 0,
  workers:process.env.CI ? 2 : undefined,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure',
    launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
    {name:'mobile',use:{...devices['Pixel 7'],viewport:{width:390,height:844}}}],
  webServer:{command:'npm run preview -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},
});
