import {
  ViewPlugin,
  Decoration,
  WidgetType,
  keymap,
} from '@codemirror/view';
import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  EditorSelection,
} from '@codemirror/state';


const insert = view => {
  const {txt} = view.state.field(State) || {};

  if (!txt) {
    return false;
  }

  const {state} = view;
  const {selection: {main: {head: pos}}} = state;

  view.dispatch({
    changes: {from: pos, to: pos, insert: txt},
    range: EditorSelection.cursor(pos + txt.length),
    userEvent: 'input.complete',
  });

  return true;
};


const ConfigFacet = Facet.define({
  combine(value) {
    const v = value.at(-1);
    const {onChange} = v || {};
    return {
      onChange,
    };
  },
});


const State = StateField.define({
  create() {
    return {id: 1, txt: ''};
  },
  update(currentValue, txn) {
    let {id: currentId, txt: currentTxt} = currentValue;
    const effect = txn.effects.find(e => e.is(SuggestionEffect));
    if (txn.state.doc) {
      if (effect) {
        const id = Number(effect.value.id.replace(/[^\d]/g, ''));
        if (id === currentId) {
          return {...currentValue, txt: currentTxt + effect.value.text};
        }
      }
      if (!txn.docChanged && !txn.selection) {
        return currentValue;
      }
    }
    return {id: currentId + 1, txt: ''};
  },
});


class SuggestionWidget extends WidgetType {
  constructor(txt) {
    super();
    this.txt = txt;
  }
  toDOM(view) {
    const span = document.createElement('span');
    span.style.opacity = '0.4';
    span.className = 'cm-inline-suggestion';
    span.textContent = this.txt;
    span.onclick = insert.bind(null, view);
    return span;
  }
}

const OnRender = ViewPlugin.fromClass(
  class Plugin {
    decorations;
    constructor() {
      this.decorations = Decoration.none;
    }
    update(update) {
      const {txt} = update.state.field(State);
      if (!txt) {
        this.decorations = Decoration.none;
        return;
      }

      const pos = update.view.state.selection.main.head;
      const widgets = [];
      const w = Decoration.widget({
        widget: new SuggestionWidget(txt),
        side: 1,
      });
      widgets.push(w.range(pos));
      this.decorations = Decoration.set(widgets);
    }
  },
  {decorations: (v) => v.decorations},
);



const OnUpdate = ViewPlugin.fromClass(
  class Plugin {
    _to;
    constructor() {
      this._to = null;
    }
    async update(update) {
      const {view, docChanged, focusChanged, state: {doc}} = update;
      const {id} = update.state.field(State);
      const {onChange} = view.state.facet(ConfigFacet);
      if (docChanged) {
        if (this._to != null) {
          clearTimeout(this._to);
        }
        const str = doc.toString();
        if (str.length > 5) {
          onChange(id.toString(), str, 0);
          this._to = setTimeout(() => {
            onChange(`${id}*`, str, 256);
          }, 250);
        }
      }
    }
  },
);


const Keymap = Prec.highest(
  keymap.of([
    {
      key: 'Tab',
      run: insert.bind(null),
    },
  ]),
);


export const SuggestionEffect = StateEffect.define();

export default ({onChange}) => [
  ConfigFacet.of({onChange}),
  State,
  OnRender,
  OnUpdate,
  Keymap,
];
