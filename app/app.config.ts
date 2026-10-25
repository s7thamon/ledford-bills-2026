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
      },
      compoundVariants: [
        // Default yellow-on-pale-yellow fails contrast in light mode.
        { color: 'warning', variant: 'soft', class: 'text-(--ui-color-warning-700) dark:text-warning' }
      ]
    },
    table: {
      slots: {
        th: 'px-5 py-3 text-sm text-toned font-semibold bg-elevated/40',
        // Subtle zebra striping, lighter than the header row.
        tr: 'even:bg-elevated/12 dark:even:bg-white/3',
        td: 'px-5 py-3.5 text-sm text-default'
      }
    }
  }
})
