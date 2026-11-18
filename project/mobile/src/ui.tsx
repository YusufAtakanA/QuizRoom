import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import type { Standing } from './core'
import type { LinkState } from './net'

const light = {
  background: '#F5F5F7',
  card: '#FFFFFF',
  surface2: '#FAFAFC',
  label: '#1D1D1F',
  secondary: '#6E6E73',
  separator: 'rgba(60,60,67,0.14)',
  controlBorder: '#8A8A8E',
  fill: 'rgba(118,118,128,0.10)',
  accentFill: '#4F46E5',
  accentPressed: '#3F37C9',
  accent: '#4F46E5',
  accentTint: '#ECEBFD',
  accentTintPressed: '#DCDAFA',
  onAccent: '#FFFFFF',
  success: '#1F7A35',
  warning: '#B25000',
  error: '#D70015',
  cardShadow: true,
}

const dark: typeof light = {
  background: '#0B0B0F',
  card: '#1C1C1F',
  surface2: '#26262A',
  label: '#F5F5F7',
  secondary: '#98989D',
  separator: 'rgba(255,255,255,0.09)',
  controlBorder: '#7C7C80',
  fill: 'rgba(118,118,128,0.22)',
  accentFill: '#5E5CE6',
  accentPressed: '#4F4DD6',
  accent: '#A5A1FF',
  accentTint: '#25233F',
  accentTintPressed: '#312E55',
  onAccent: '#FFFFFF',
  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF6961',
  cardShadow: false,
}

export const ANSWERS = [
  { letter: 'A', shape: '▲', name: 'triangle', face: '#D70015', text: '#FFFFFF', plinth: '#8E000E' },
  { letter: 'B', shape: '◆', name: 'diamond', face: '#0A5AD6', text: '#FFFFFF', plinth: '#063C8F' },
  { letter: 'C', shape: '●', name: 'circle', face: '#FFCC00', text: '#1D1D1F', plinth: '#8F6B00' },
  { letter: 'D', shape: '■', name: 'square', face: '#1F7A35', text: '#FFFFFF', plinth: '#124A20' },
]

export const SPRING = {
  release: { stiffness: 632, damping: 50.3, mass: 1 },
  nav: { stiffness: 439, damping: 41.9, mass: 1 },
  content: { stiffness: 322, damping: 35.9, mass: 1 },
  move: { stiffness: 195, damping: 27.9, mass: 1 },
  lock: { stiffness: 439, damping: 31.4, mass: 1 },
  arrive: { stiffness: 195, damping: 22.9, mass: 1 },
  podium: { stiffness: 158, damping: 20.1, mass: 1 },
}

export const spring = (value: Animated.Value, toValue: number, config: (typeof SPRING)[keyof typeof SPRING], delay = 0) =>
  Animated.spring(value, { toValue, ...config, delay, useNativeDriver: true })

export const press = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: 90, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true })

export const fade = (value: Animated.Value, toValue: number, delay = 0) =>
  Animated.timing(value, { toValue, duration: 150, delay, easing: Easing.ease, useNativeDriver: true })

export type Theme = typeof light
export const useTheme = () => (useColorScheme() === 'dark' ? dark : light)

let reducedNow = false
const reducedListeners = new Set<() => void>()
const setReducedNow = (v: boolean) => {
  reducedNow = v
  reducedListeners.forEach((l) => l())
}
void AccessibilityInfo.isReduceMotionEnabled().then(setReducedNow)
AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedNow)
const subscribeReduced = (l: () => void) => {
  reducedListeners.add(l)
  return () => void reducedListeners.delete(l)
}

export const useReducedMotion = () => useSyncExternalStore(subscribeReduced, () => reducedNow)

export function animateNextLayout(reduced: boolean) {
  if (reduced) return
  LayoutAnimation.configureNext({
    duration: 575,
    update: { type: 'spring', springDamping: 1 },
    create: { type: 'spring', springDamping: 0.82, property: 'scaleXY' },
    delete: { type: 'easeOut', property: 'opacity', duration: 150 },
  })
}

export function Appear({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion()
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const a = reduced ? fade(v, 1) : spring(v, 1, SPRING.content, delay)
    a.start()
    return () => a.stop()
  }, [])
  const translateY = reduced ? 0 : v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] })
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>{children}</Animated.View>
}

export function card(t: Theme): ViewStyle {
  return t.cardShadow
    ? { backgroundColor: t.card, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 }
    : { backgroundColor: t.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' }
}

export function LargeTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  const t = useTheme()
  return (
    <View style={s.titleBlock}>
      <Text style={[s.largeTitle, { color: t.label }]} accessibilityRole="header">
        {children}
      </Text>
      {subtitle ? <Text style={[s.body, { color: t.secondary }]}>{subtitle}</Text> : null}
    </View>
  )
}

export function Button({
  title,
  onPress,
  kind = 'filled',
  busy,
  disabled,
  hint,
}: {
  title: string
  onPress: () => void
  kind?: 'filled' | 'tinted' | 'plain'
  busy?: boolean
  disabled?: boolean
  hint?: string
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useRef(new Animated.Value(1)).current
  const off = disabled || busy
  const fg = off ? t.label : kind === 'filled' ? t.onAccent : t.accent
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => reduced || press(scale, 0.97).start()}
      onPressOut={() => reduced || spring(scale, 1, SPRING.release).start()}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
    >
      {({ pressed }) => (
        <Animated.View style={[s.button, { transform: [{ scale }] }]}>
          <View
            style={[
              s.buttonFill,
              {
                backgroundColor:
                  kind === 'filled' ? (pressed ? t.accentPressed : t.accentFill) : kind === 'tinted' ? (pressed ? t.accentTintPressed : t.accentTint) : pressed ? t.fill : 'transparent',
                opacity: off ? 0.4 : 1,
              },
            ]}
          />
          {busy && !reduced ? <ActivityIndicator color={fg} style={s.spinner} /> : null}
          <Text style={[s.buttonText, { color: fg }]}>{title}</Text>
        </Animated.View>
      )}
    </Pressable>
  )
}

export function Group({ header, footer, children, style }: { header?: string; footer?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View style={[s.groupWrap, style]}>
      {header ? (
        <Text style={[s.groupHeader, { color: t.secondary }]} accessibilityRole="header">
          {header}
        </Text>
      ) : null}
      <View style={[s.group, card(t)]}>{children}</View>
      {footer ? <Text style={[s.footnote, s.groupFooter, { color: t.secondary }]}>{footer}</Text> : null}
    </View>
  )
}

export function Row({ children, first, style }: { children: ReactNode; first?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View style={[s.row, style]}>
      {first ? null : <View style={[s.separator, { backgroundColor: t.separator }]} />}
      {children}
    </View>
  )
}

export function Pill({ state }: { state: LinkState }) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const ok = state === 'open'
  const breath = useRef(new Animated.Value(1)).current
  useEffect(() => {
    breath.setValue(1)
    if (ok || reduced) return
    const breathe = (toValue: number) => Animated.timing(breath, { toValue, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    const a = Animated.loop(Animated.sequence([breathe(0.4), breathe(1)]))
    a.start()
    return () => a.stop()
  }, [ok, reduced])
  const label = ok ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Reconnecting…'
  return (
    <View style={[s.pill, { backgroundColor: t.fill }]} accessibilityRole="text" accessibilityLabel={`Connection: ${label}`} accessibilityLiveRegion="polite">
      <Animated.View style={[s.dot, { backgroundColor: ok ? t.success : t.warning, opacity: breath }]} />
      <Text style={[s.footnote, s.pillText, { color: t.label }]}>{label}</Text>
    </View>
  )
}

export const ordinal = (n: number) => {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

export function Board({ rows, me, title, deltas }: { rows: Standing[]; me: string; title: string; deltas?: Map<string, number> }) {
  const t = useTheme()
  return (
    <Group header={title}>
      {rows.length === 0 ? (
        <Row first>
          <Text style={[s.body, { color: t.secondary }]}>No players.</Text>
        </Row>
      ) : (
        rows.map((r, i) => {
          const mine = r.playerId === me
          const d = deltas?.get(r.playerId) ?? 0
          const move = d > 0 ? `, up ${d} place${d === 1 ? '' : 's'}` : d < 0 ? `, down ${-d} place${d === -1 ? '' : 's'}` : ''
          return (
            <Row key={r.playerId} first={i === 0} style={[s.boardRowWrap, mine && { backgroundColor: t.accentTint }]}>
              {mine ? <View style={[s.youBar, { backgroundColor: t.accent }]} /> : null}
              <View style={s.boardRow} accessible accessibilityLabel={`Rank ${r.rank}, ${r.nickname}${mine ? ', you' : ''}, ${r.score} point${r.score === 1 ? '' : 's'}${move}`}>
                <Text style={[s.rank, { color: r.rank <= 3 || mine ? t.label : t.secondary }]}>{r.rank <= 3 ? ordinal(r.rank) : r.rank}</Text>
                <Text style={[s.body, s.grow, { color: t.label, fontWeight: mine ? '600' : '400' }]} numberOfLines={1}>
                  {r.nickname}
                  {mine ? <Text style={{ color: t.accent, fontWeight: '600' }}>  You</Text> : null}
                </Text>
                {d !== 0 ? (
                  <Appear style={[s.delta, { backgroundColor: mine ? t.card : t.fill }]}>
                    <Text style={[s.footnote, s.deltaText, { color: d > 0 ? t.success : t.secondary }]}>{d > 0 ? `▲${d}` : `▼${-d}`}</Text>
                  </Appear>
                ) : null}
                <Text style={[s.body, s.score, { color: t.label }]}>{r.score}</Text>
              </View>
            </Row>
          )
        })
      )}
    </Group>
  )
}

export function Podium({ rows, animate }: { rows: Standing[]; animate: boolean }) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const top = rows.slice(0, 3)
  const values = useRef([0, 1, 2].map(() => new Animated.Value(animate ? 0 : 1))).current
  useEffect(() => {
    if (!animate) return
    const order = [2, 1, 0].filter((i) => i < top.length)
    const a = reduced
      ? Animated.parallel(order.map((i) => fade(values[i], 1)))
      : Animated.parallel(order.map((i, n) => spring(values[i], 1, SPRING.podium, n * 140)))
    a.start()
    return () => a.stop()
  }, [])
  if (top.length === 0) return null
  const height = (rank: number) => (rank === 1 ? 140 : rank === 2 ? 90 : 68)
  const visual = [1, 0, 2].filter((i) => i < top.length)
  return (
    <View style={s.podium} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {visual.map((i) => {
        const r = top[i]
        const first = r.rank === 1
        const v = values[i]
        const translateY = reduced ? 0 : v.interpolate({ inputRange: [0, 1], outputRange: [height(r.rank), 0] })
        return (
          <Animated.View key={r.playerId} style={[s.podiumCol, { opacity: v, transform: [{ translateY }] }]}>
            <Text style={[first ? s.title2 : s.headline, s.center, { color: t.label }]} numberOfLines={1}>
              {r.nickname}
            </Text>
            <Text style={[s.footnote, s.center, s.tabular, { color: t.secondary }]}>{`${r.score} point${r.score === 1 ? '' : 's'}`}</Text>
            <View style={[s.podiumBlock, { height: height(r.rank), backgroundColor: first ? t.accentFill : t.surface2 }]}>
              <Text style={[s.title2, s.tabular, { color: first ? t.onAccent : t.label }]}>{ordinal(r.rank)}</Text>
            </View>
          </Animated.View>
        )
      })}
    </View>
  )
}

export const s = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  titleBlock: { paddingTop: 12, paddingBottom: 24, gap: 8 },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.37 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.36 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: 0.35 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 22, letterSpacing: -0.41 },
  subhead: { fontSize: 15, lineHeight: 20, letterSpacing: -0.24 },
  footnote: { fontSize: 13, lineHeight: 18, letterSpacing: -0.08 },
  tabular: { fontVariant: ['tabular-nums'] },
  center: { textAlign: 'center' },
  grow: { flex: 1 },
  button: { minHeight: 50, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 17, fontWeight: '600', letterSpacing: -0.41 },
  buttonFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderCurve: 'continuous' },
  spinner: { marginRight: 8 },
  groupWrap: { marginBottom: 24 },
  groupHeader: { fontSize: 13, lineHeight: 18, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 },
  groupFooter: { paddingHorizontal: 16, paddingTop: 8 },
  group: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden' },
  row: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center' },
  separator: { position: 'absolute', top: 0, left: 16, right: 0, height: StyleSheet.hairlineWidth },
  boardRowWrap: { minHeight: 52 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  youBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  rank: { fontSize: 17, minWidth: 36, fontWeight: '600', fontVariant: ['tabular-nums'] },
  score: { fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 24, textAlign: 'right' },
  delta: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderCurve: 'continuous' },
  deltaText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 28, borderRadius: 999 },
  pillText: { fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 24, paddingTop: 8, overflow: 'hidden' },
  podiumCol: { flex: 1, gap: 2 },
  podiumBlock: { marginTop: 8, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
})
