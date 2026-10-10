
const changeHandlers = [];
let activeModel = null;
window.__testEditorSource = () => activeModel?.getValue();
window.__testEditSource = (source) => activeModel?.setValue(source);

export const Uri = { parse: (text) => text };
export const languages = {register(){},setLanguageConfiguration(){},setMonarchTokensProvider(){},registerCompletionItemProvider(){}};
export const editor = {
  create(_host, options) {
    return {
      setModel(model){activeModel=model;},
      updateOptions(){}, layout(){},
      onDidChangeModelContent(callback){changeHandlers.push(callback);},
      onDidChangeCursorPosition(){},
      getModel(){return activeModel;},
      setSelection(range){window.__editorSelection=range;},
      revealRangeInCenter(range){window.__editorReveal=range;},
      focus(){window.__editorFocused=true;},
    };
  },
  createModel(value, language, uri) {
    const model = {value,language,uri, getValue(){return this.value;},
       setValue(next){this.value=next; if (activeModel===this) for(const fn of changeHandlers)fn();},
       getLineCount(){return this.value.split(/\r?\n/).length;},
       getLineMaxColumn(line){return (this.value.split(/\r?\n/)[line-1] || '').length + 1;},
       dispose(){this.disposed=true;}};
    return model;
  },
  defineTheme(){}, setTheme(){},
};
