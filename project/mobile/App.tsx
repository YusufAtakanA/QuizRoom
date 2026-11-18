import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Player } from './src/core'
import { Game } from './src/Game'
import { Join } from './src/Join'

export default function App() {
  const [player, setPlayer] = useState<Player | null>(null)
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {player ? <Game key={player.sessionId} player={player} onLeave={() => setPlayer(null)} /> : <Join onJoined={setPlayer} />}
    </SafeAreaProvider>
  )
}
