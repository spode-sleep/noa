declare module 'vue-book-reader' {
  import { DefineComponent } from 'vue'
  export const VueReader: DefineComponent<{
    url: string
    getRendition?: (rendition: any) => void
  }>
}
