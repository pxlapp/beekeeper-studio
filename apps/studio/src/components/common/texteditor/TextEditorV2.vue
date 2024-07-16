<template>
  <div class="editor" ref="editor" />
</template>

<script lang='ts'>
import { uuidv4 } from '@/lib/uuid'
import axios from 'axios'
import { mapState, mapGetters } from 'vuex'
import { closeBrackets, autocompletion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { basicSetup, gutter, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, EditorView } from '@codemirror/view'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import {xcodeLight, xcodeDark} from './xcode';
import copilot, { SuggestionEffect } from './copilot'

export default {
  props: [
    'value',
    'lang',
    'initialized',
    'forcedValue',
  ],
  data() {
    return {
      id: uuidv4(),
      editor: null,
      to: null,
      canPxl: false,
    };
  },
  computed: {
    ...mapGetters(['defaultSchema']),
    ...mapGetters({
      'pxlApiUrl': 'settings/pxlApiUrl',
      'pxlAccessToken': 'settings/pxlAccessToken'
    }),
    ...mapState(['pxlReady', 'tables']),
    ...mapState('tabs', { 'activeTab': 'active' }),
    schema() {
      return this.tables
        .reduce((acc, t) => {
          if (t.schema === this.defaultSchema && t.entityType === 'table') {
            acc.push({
              name: t.name,
              columns: t.columns?.map(c => ({
                name: c.columnName,
                type: c.rawDataType,
              })) || null,
            });
          }
          return acc;
        }, [])
        .map(({name, columns}) => (
          [
            `CREATE TABLE ${name} (\n`,
            columns.map(({name, type}) => `\t${name} ${type}`).join(',\n'),
            '\n);\n',
          ].join(''))
        )
        .join('');
    }
  },
  watch: {
    forcedValue() {
      console.error('forcedValue() not implemented yet');
      /*this.editor.setValue(this.forcedValue);*/
    },
    readOnly() {
      console.error('readOnly() not implemented yet');
      /*this.editor.setOption('readOnly', this.readOnly);*/
    },
    async focus() {
      console.error('focus() not implemented yet');
      /*if (this.focus && this.editor) {
        this.editor.focus();
        await this.$nextTick();
        // this fixes the editor not showing because it doesn't think it's dom element is in view.
        // its a hit and miss error
        this.editor.refresh();
      }*/
    },
    tables: async function() {
      try {
        const url = new URL(this.pxlApiUrl);
        url.pathname = '/v1/sql/session';
        const resp = await fetch(
          url.toString(),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.pxlAccessToken}`,
            },
            body: JSON.stringify({
              sessionId: this.id,
              schema: this.schema,
            }),
          }
        );

        this.$set(this, 'canPxl', true);
        this.pxl('0', '', 0);
      } catch (e) {
        console.error(err);
      }
    }
  },
  methods: {
    initialize() {
      this.destroyEditor();

      const cm = new EditorView({
        doc: this.value,
        extensions: [
          keymap.of([indentWithTab]),
          lineNumbers(),
          gutter({}),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          closeBrackets(),
          bracketMatching(),
          sql({
            dialect: PostgreSQL,
          }),
          xcodeLight,
          copilot({
            onChange: this.onChange,
          }),
        ],
        parent: this.$refs.editor,
      });

      this.editor = cm;

      this.$emit('update:initialized', true);
    },
    destroyEditor() {
      if (this.editor) {
        this.editor.destroy();
      }
    },
    onChange(id: string, str: string, maxTokens: number) {
      if (this.pxlReady === true) {
        this.pxl(id, str, maxTokens);
      }
      this.$emit('input', str);
    },
    async pxl(reqId: string, str: string, maxTokens: number) {
      if (this.canPxl !== true) return;
      try {
        const url = new URL(this.pxlApiUrl);
        url.pathname = '/v1/sql/completion';
        const resp = await fetch(
          url.toString(),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.pxlAccessToken}`,
            },
            body: JSON.stringify({
              sessionId: this.id,
              requestId: reqId,
              schema: this.schema,
              prompt: str,
              grammarId: 'pgsql',
              maxTokens,
            }),
          }
        );

        const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();

        /* eslint-disable-next-line */
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          value
            .split('\n')
            .filter(l => l.trim() !== '')
            .forEach(l => {
              const payload = l.replace(/^data: /, '');
              try {
                const msg = JSON.parse(payload);
                if (msg.ok && !(msg.error || msg.cancel || msg.stop)) {
                  this.editor.dispatch({
                    effects: SuggestionEffect.of({id: msg.requestId, text: msg.token}),
                  });
                }
              } catch (err) {
                console.error('failed parsing json', payload, err);
              }
            });
        }
      } catch (err) {
        console.error(err);
      }
    }
  },
  mounted() {
    this.initialize();
  },
  beforeDestroy() {
    if (this.to !== null) {
      clearTimeout(this.to);
      this.to = null;
    }
    this.destroyEditor();
  },
};
</script>
