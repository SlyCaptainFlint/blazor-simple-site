/** Create a fresh element from a bundled HTML template with one root element. */
export function createTemplateElement<T extends HTMLElement>(html: string): T {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild as T;
}
