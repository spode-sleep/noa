import { addIcon } from '@iconify/vue'

// Import all MDI icons used across the application
// This ensures they are bundled and available offline without CDN requests
import mdiAlbum from '@iconify/icons-mdi/album'
import mdiArrowLeft from '@iconify/icons-mdi/arrow-left'
import mdiCheck from '@iconify/icons-mdi/check'
import mdiCheckCircle from '@iconify/icons-mdi/check-circle'
import mdiCheckboxBlank from '@iconify/icons-mdi/checkbox-blank'
import mdiChevronDown from '@iconify/icons-mdi/chevron-down'
import mdiChevronUp from '@iconify/icons-mdi/chevron-up'
import mdiClose from '@iconify/icons-mdi/close'
import mdiCloseCircle from '@iconify/icons-mdi/close-circle'
import mdiContentCopy from '@iconify/icons-mdi/content-copy'
import mdiDelete from '@iconify/icons-mdi/delete'
import mdiFileDocumentOutline from '@iconify/icons-mdi/file-document-outline'
import mdiFolder from '@iconify/icons-mdi/folder'
import mdiGamepadVariant from '@iconify/icons-mdi/gamepad-variant'
import mdiHelpCircle from '@iconify/icons-mdi/help-circle'
import mdiInformation from '@iconify/icons-mdi/information'
import mdiLightbulbOnOutline from '@iconify/icons-mdi/lightbulb-on-outline'
import mdiMusicNote from '@iconify/icons-mdi/music-note'
import mdiMinusCircle from '@iconify/icons-mdi/minus-circle'
import mdiPackageVariantClosed from '@iconify/icons-mdi/package-variant-closed'
import mdiPause from '@iconify/icons-mdi/pause'
import mdiPencil from '@iconify/icons-mdi/pencil'
import mdiPlay from '@iconify/icons-mdi/play'
import mdiPlaylistPlus from '@iconify/icons-mdi/playlist-plus'
import mdiPlus from '@iconify/icons-mdi/plus'
import mdiRepeat from '@iconify/icons-mdi/repeat'
import mdiRepeatOnce from '@iconify/icons-mdi/repeat-once'
import mdiSkipNext from '@iconify/icons-mdi/skip-next'
import mdiSkipPrevious from '@iconify/icons-mdi/skip-previous'
import mdiSteam from '@iconify/icons-mdi/steam'
import mdiTagMultiple from '@iconify/icons-mdi/tag-multiple'
import mdiThumbDown from '@iconify/icons-mdi/thumb-down'
import mdiThumbUp from '@iconify/icons-mdi/thumb-up'
import mdiVolumeHigh from '@iconify/icons-mdi/volume-high'
import mdiWrench from '@iconify/icons-mdi/wrench'

const icons: Record<string, typeof mdiFolder> = {
  'mdi:album': mdiAlbum,
  'mdi:arrow-left': mdiArrowLeft,
  'mdi:check': mdiCheck,
  'mdi:check-circle': mdiCheckCircle,
  'mdi:checkbox-blank': mdiCheckboxBlank,
  'mdi:chevron-down': mdiChevronDown,
  'mdi:chevron-up': mdiChevronUp,
  'mdi:close': mdiClose,
  'mdi:close-circle': mdiCloseCircle,
  'mdi:content-copy': mdiContentCopy,
  'mdi:delete': mdiDelete,
  'mdi:file-document-outline': mdiFileDocumentOutline,
  'mdi:folder': mdiFolder,
  'mdi:gamepad-variant': mdiGamepadVariant,
  'mdi:help-circle': mdiHelpCircle,
  'mdi:information': mdiInformation,
  'mdi:lightbulb-on-outline': mdiLightbulbOnOutline,
  'mdi:music-note': mdiMusicNote,
  'mdi:minus-circle': mdiMinusCircle,
  'mdi:package-variant-closed': mdiPackageVariantClosed,
  'mdi:pause': mdiPause,
  'mdi:pencil': mdiPencil,
  'mdi:play': mdiPlay,
  'mdi:playlist-plus': mdiPlaylistPlus,
  'mdi:plus': mdiPlus,
  'mdi:repeat': mdiRepeat,
  'mdi:repeat-once': mdiRepeatOnce,
  'mdi:skip-next': mdiSkipNext,
  'mdi:skip-previous': mdiSkipPrevious,
  'mdi:steam': mdiSteam,
  'mdi:tag-multiple': mdiTagMultiple,
  'mdi:thumb-down': mdiThumbDown,
  'mdi:thumb-up': mdiThumbUp,
  'mdi:volume-high': mdiVolumeHigh,
  'mdi:wrench': mdiWrench,
}

for (const [name, data] of Object.entries(icons)) {
  addIcon(name, data)
}
