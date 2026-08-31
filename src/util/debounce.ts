/**
 * 防抖：在最后一次调用后 waitMs 毫秒才真正执行 fn。
 * 返回的函数带 cancel()，供 Disposable 释放时清理定时器。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;

  const wrapped = (...args: A): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };

  wrapped.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return wrapped;
}
