declare module '../../shared/inputClassifier.js' {
  export function classifyInlineInput(text: string): 'shell' | 'natural';
  export function classifyPastedText(raw: string): 'natural_language' | 'command' | 'mixed' | 'uncertain';
}
