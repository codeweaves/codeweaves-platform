/** CSS reset for Shadow DOM — isolates widget from host page styles */
export const resetCSS = `
:host {
  all: initial;
  display: block;
  box-sizing: border-box;
  visibility: visible;
  direction: inherit;
  writing-mode: inherit;
}
*, *::before, *::after {
  box-sizing: border-box;
}
`;
