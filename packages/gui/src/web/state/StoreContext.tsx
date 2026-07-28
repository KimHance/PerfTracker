import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { ApiClient } from '../api/client.js'
import type { EffectDeps } from '../effects/effects.js'
import type { Action } from './actions.js'
import { type AppState, initialState } from './model.js'
import { reducer } from './reducer.js'

/**
 * 상태 하나, 리듀서 하나. 상태 라이브러리를 들이지 않은 것은 취향이 아니라 계약이다 —
 * 이 화면의 상태 전이는 `Action` 목록으로 전부 셀 수 있어야 하고, 그래야
 * "측정 중에 무엇이 바뀔 수 있는가" 를 코드를 읽어 답할 수 있다.
 */

interface Store {
  state: AppState
  dispatch: (action: Action) => void
  /** effects 에 그대로 넘기는 묶음. 컴포넌트가 api 를 직접 만지지 않게 하려고 여기서만 준다. */
  deps: EffectDeps
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState())
  const deps = useMemo<EffectDeps>(() => ({ api, dispatch }), [api])
  const value = useMemo<Store>(() => ({ state, dispatch, deps }), [state, deps])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('StoreProvider 안에서만 useStore 를 쓸 수 있습니다')
  return store
}
