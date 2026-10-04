import aboutHtml from './templates/about.html?raw';

export function renderAbout(main: HTMLElement): void {
  main.innerHTML = aboutHtml;
}
