declare module 'jsmediatags' {
  interface Tags {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    [key: string]: any;
  }
  interface TagResult {
    tags: Tags;
  }
  interface Callbacks {
    onSuccess(result: TagResult): void;
    onError(error: any): void;
  }
  function read(file: string | File, callbacks: Callbacks): void;
}
