import { useSyncExternalStore } from 'react'
import { orderflowStore } from './orderflowStore'

/** Subscribe React views to the store's at-most-10 Hz immutable UI snapshot. */
export function useOrderflow() {
  return useSyncExternalStore(
    orderflowStore.subscribe,
    orderflowStore.getSnapshot,
    orderflowStore.getServerSnapshot,
  )
}
