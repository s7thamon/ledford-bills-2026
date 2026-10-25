export default defineAppConfig({
  ui: {
    colors: {
      primary: 'sky',
      neutral: 'mist'
    },
    header: {
      slots: {
        root: 'bg-default/80 backdrop-blur-md border-b border-default shadow-[0_1px_3px_rgb(15_26_30/0.04)]'
      }
    },
    card: {
      slots: {
        root: 'surface-card overflow-hidden'
      },
      variants: {
        variant: {
          outline: { root: 'ring-0 divide-y divide-default' }
        }
      }
    },
    badge: {
      slots: {
        base: 'rounded-full'
      }
    },
    table: {
      slots: {
        th: 'px-5 py-3 text-sm text-toned font-semibold bg-elevated/40',
        td: 'px-5 py-3.5 text-sm text-default'
      }
    }
  }
})
