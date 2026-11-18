import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { StatusBar } from 'expo-status-bar'
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, StyleSheet, useWindowDimensions } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { SafeAreaView } from 'react-native-safe-area-context'
import { messageFor, parseCode, type Player } from './core'
import { ApiError, api, roomPath } from './net'
import { Button, Group, LargeTitle, Row, SPRING, s, spring, useReducedMotion, useTheme } from './ui'

export function Join({ onJoined }: { onJoined: (p: Player) => void }) {
  const t = useTheme()
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [denied, setDenied] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const nickRef = useRef<ComponentRef<typeof TextInput>>(null)
  const reduceMotion = useReducedMotion()
  const codeReady = /^[A-Z0-9]{6}$/.test(code)
  const stacked = useWindowDimensions().fontScale >= 1.3

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error)
  }, [error])

  async function scan() {
    setError('')
    const granted = permission?.granted || (await requestPermission()).granted
    setDenied(!granted)
    if (granted) setScanning(true)
  }

  function scanned(roomCode: string) {
    setScanning(false)
    setCode(roomCode)
    if (!nickname.trim()) setTimeout(() => nickRef.current?.focus(), 400)
  }

  async function join() {
    const roomCode = code.trim().toUpperCase()
    const name = nickname.trim()
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return setError('Enter the 6-character room code from the host\'s screen.')
    if (!name) return setError('Please enter a nickname.')
    setBusy(true)
    setError('')
    try {
      const joined = await api<Omit<Player, 'roomCode' | 'nickname'>>('POST', `${roomPath(roomCode)}/players`, { nickname: name })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      onJoined({ ...joined, roomCode, nickname: name })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : messageFor(''))
      setBusy(false)
    }
  }

  const input = [s.body, j.input, { color: t.label }]

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <LargeTitle subtitle="Scan the QR code on the host's screen, or type the room code.">Join a game</LargeTitle>

          <View style={j.scanBlock}>
            <Button title="Scan QR code" kind={codeReady ? 'tinted' : 'filled'} onPress={scan} hint="Opens the camera to scan the room's QR code" />
          </View>

          {denied ? (
            <Group footer="You can still type the room code below.">
              <Row first>
                <Text style={[s.body, { color: t.label }]}>Camera access is off. Allow QuizRoom to use the camera in Settings to scan QR codes.</Text>
              </Row>
              <Row>
                <Button title="Open Settings" kind="tinted" onPress={() => void Linking.openSettings()} />
              </Row>
            </Group>
          ) : null}

          <View style={j.divider} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={[j.rule, { backgroundColor: t.separator }]} />
            <Text style={[s.footnote, { color: t.secondary }]}>or type the code</Text>
            <View style={[j.rule, { backgroundColor: t.separator }]} />
          </View>

          <Group footer="The room code has 6 letters or digits. Your nickname is shown to other players.">
            <Row first style={stacked ? j.fieldStacked : j.field}>
              <Text style={[s.body, !stacked && j.label, { color: t.label }]}>Room code</Text>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor={t.secondary}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={6}
                returnKeyType="next"
                onSubmitEditing={() => nickRef.current?.focus()}
                submitBehavior="submit"
                accessibilityLabel="Room code"
                maxFontSizeMultiplier={1.6}
                style={[...input, j.code]}
              />
            </Row>
            <Row style={stacked ? j.fieldStacked : j.field}>
              <Text style={[s.body, !stacked && j.label, { color: t.label }]}>Nickname</Text>
              <TextInput
                ref={nickRef}
                value={nickname}
                onChangeText={setNickname}
                placeholder="Your name"
                placeholderTextColor={t.secondary}
                autoCorrect={false}
                maxLength={20}
                textContentType="nickname"
                returnKeyType="join"
                onSubmitEditing={join}
                accessibilityLabel="Nickname"
                style={input}
              />
            </Row>
          </Group>

          {error ? (
            <Text style={[s.subhead, j.error, { color: t.error }]} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <Button title={busy ? 'Joining…' : 'Join'} kind={codeReady ? 'filled' : 'tinted'} onPress={join} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={scanning} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="fullScreen" onRequestClose={() => setScanning(false)}>
        <StatusBar style="light" />
        <Scanner onCode={scanned} onCancel={() => setScanning(false)} reduceMotion={reduceMotion} />
      </Modal>
    </SafeAreaView>
  )
}

function Scanner({ onCode, onCancel, reduceMotion }: { onCode: (code: string) => void; onCancel: () => void; reduceMotion: boolean }) {
  const done = useRef(false)
  const last = useRef('')
  const [hint, setHint] = useState("Point the camera at the QR code on the host's screen.")
  const [found, setFound] = useState(false)
  const [solid, setSolid] = useState(false)
  const lockOn = useRef(new Animated.Value(1)).current
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setSolid)
  }, [])

  function read({ data }: { data: string }) {
    if (done.current || data === last.current) return
    last.current = data
    const code = parseCode(data)
    if (!code) return setHint("That QR code isn't a QuizRoom game. Try the code on the host's screen.")
    done.current = true
    setFound(true)
    setHint('Room code found.')
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (!reduceMotion) spring(lockOn, 0.86, SPRING.nav).start()
    timer.current = setTimeout(() => onCode(code), 300)
  }

  const corner = { borderColor: found ? '#30D158' : '#FFFFFF' }

  return (
    <View style={j.camera}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={read} />
      <SafeAreaView style={j.overlay}>
        <View style={j.topBar}>
          <Pressable
            onPress={() => {
              clearTimeout(timer.current)
              onCancel()
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel scanning"
            style={[j.cancel, { backgroundColor: solid ? '#000000' : 'rgba(0,0,0,0.55)' }]}
            hitSlop={8}
          >
            <Text style={j.cancelText}>Cancel</Text>
          </Pressable>
        </View>
        <Animated.View style={[j.frame, { transform: [{ scale: lockOn }] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[j.corner, j.tl, corner]} />
          <View style={[j.corner, j.tr, corner]} />
          <View style={[j.corner, j.bl, corner]} />
          <View style={[j.corner, j.br, corner]} />
        </Animated.View>
        <Text style={[s.headline, j.hint, { backgroundColor: solid ? '#000000' : 'rgba(0,0,0,0.55)' }]} accessibilityLiveRegion="polite">
          {hint}
        </Text>
      </SafeAreaView>
    </View>
  )
}

const j = StyleSheet.create({
  scanBlock: { marginBottom: 20 },
  field: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0 },
  fieldStacked: { paddingTop: 12, paddingBottom: 0 },
  label: { width: 110 },
  input: { flex: 1, minHeight: 44, paddingVertical: 10 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 28, lineHeight: 34, letterSpacing: 4, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  error: { marginBottom: 16, paddingHorizontal: 16 },
  camera: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 32 },
  topBar: { alignSelf: 'stretch', flexDirection: 'row', paddingHorizontal: 8 },
  cancel: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22 },
  cancelText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  frame: { width: 260, height: 260 },
  corner: { position: 'absolute', width: 56, height: 56 },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 28 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 28 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 28 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 28 },
  hint: { color: '#FFFFFF', textAlign: 'center', marginHorizontal: 24, padding: 14, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
})
