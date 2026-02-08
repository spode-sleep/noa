declare module 'vue-book-reader' {
  import { DefineComponent } from 'vue'
  export const VueReader: DefineComponent<{
    url: string
    location?: string | number | object
    title?: string
    showToc?: boolean
    getRendition?: (rendition: any) => void
    'onUpdate:location'?: (location: any) => void
  }>
}
