import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import * as Haptics from 'expo-haptics'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { OpenQuestion, Participant, Player, Reveal, Snapshot, Standing } from './core'
import { ApiError, api, roomPath, useLive, useResync } from './net'
import {
  ANSWERS,
  Appear,
  Board,
  Button,
  Group,
  LargeTitle,
  Pill,
  Podium,
  Row,
  SPRING,
  animateNextLayout,
  card,
  fade,
  ordinal,
  press,
  s,
  spring,
  useReducedMotion,
  useTheme,
} from './ui'

type Phase = 'loading' | 'lobby' | 'waiting' | 'question' | 'ended' | 'gone'
type Mode = 'idle' | 'chosen' | 'correct' | 'receded' | 'wrong'
type Outcome = 'right' | 'wrong' | 'first' | 'none'

export function Game({ player: me, onLeave }: { player: Player; onLeave: () => void }) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('loading')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const [question, setQuestion] = useState<OpenQuestion | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [leaderboard, setLeaderboard] = useState<Standing[]>([])
  const [scoreboard, setScoreboard] = useState<Standing[]>([])
  const [message, setMessage] = useState('')
  const [endedLive, setEndedLive] = useState(false)
  const [deltas, setDeltas] = useState<Map<string, number>>(new Map())
  const ranks = useRef<Map<string, number> | null>(null)
  const { fontScale } = useWindowDimensions()

  function track(rows: Standing[], diff: boolean) {
    const before = diff ? ranks.current : null
    const next = new Map<string, number>()
    if (before)
      for (const r of rows) {
        const was = before.get(r.playerId)
        if (was !== undefined && was !== r.rank) next.set(r.playerId, was - r.rank)
      }
    ranks.current = new Map(rows.map((r) => [r.playerId, r.rank]))
    setDeltas(next)
  }

  function resetAnswer() {
    setChoice(null)
    setLocked(false)
    setAccepted(false)
    setMessage('')
  }

  const sync = useResync(snapshot, apply, (event) => {
    if (event.type === 'participants:update') {
      if (phase === 'lobby' || phase === 'waiting') animateNextLayout(reduced)
      setParticipants(event.participants)
    }
    if (event.type === 'game:started') {
      setQuestionCount(event.questionCount)
      setPhase('waiting')
    }
    if (event.type === 'question:opened') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setQuestion(event)
      resetAnswer()
      setReveal(null)
      setPhase('question')
    }
    if (event.type === 'question:closed') {
      setReveal(event)
      setLocked(true)
    }
    if (event.type === 'leaderboard:update') {
      if (revealed) animateNextLayout(reduced)
      track(event.leaderboard, true)
      setLeaderboard(event.leaderboard)
    }
    if (event.type === 'game:ended') {
      setScoreboard(event.scoreboard)
      setEndedLive(true)
      setPhase('ended')
    }
  })
  const link = useLive(phase === 'ended' || phase === 'gone' ? undefined : me.channel, me.joinKey, me.participantId, sync.event, sync.snapshot)

  function snapshot() {
    return api<Snapshot>('GET', roomPath(me.roomCode), undefined, { 'X-Session-Id': me.sessionId }).catch((e) => {
      if (e instanceof ApiError && e.status === 404) {
        setMessage(e.message)
        setPhase('gone')
      } else if (phase === 'loading') {
        setMessage(e instanceof ApiError ? e.message : '')
        setPhase('lobby')
      }
      return null
    })
  }

  function apply(snap: Snapshot) {
    if (snap.eventId === undefined) {
      if (phase === 'loading') setPhase(snap.status === 'LOBBY' ? 'lobby' : snap.status === 'IN_PROGRESS' ? 'waiting' : 'ended')
      return
    }
    setParticipants(snap.participants)
    setQuestionCount(snap.questionCount)
    setLeaderboard(snap.leaderboard)
    track(snap.leaderboard, false)
    setScoreboard(snap.scoreboard ?? [])
    if (snap.question && snap.question.index !== question?.index) resetAnswer()
    if (snap.question && !snap.open) setLocked(true)
    if (snap.question && snap.myAnswer != null) {
      setChoice(snap.myAnswer)
      setLocked(true)
      setAccepted(true)
    }
    setQuestion(snap.question)
    setReveal(snap.reveal)
    setPhase(snap.status === 'LOBBY' ? 'lobby' : snap.status === 'FINISHED' ? 'ended' : snap.question ? 'question' : 'waiting')
  }

  useEffect(() => {
    void sync.snapshot()
  }, [])

  const revealed = reveal !== null && reveal.index === question?.index
  const outcome: Outcome | null = !revealed ? null : !accepted ? 'none' : choice === null ? 'first' : choice === reveal.correctIndex ? 'right' : 'wrong'

  useEffect(() => {
    if (!outcome || !revealed) return
    if (outcome === 'right') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (outcome === 'wrong') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    AccessibilityInfo.announceForAccessibility(outcomeCopy(outcome, reveal.correctIndex).speech)
  }, [outcome])

  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message)
  }, [message])

  async function answer(optionIndex: number) {
    if (locked) return
    setChoice(optionIndex)
    setLocked(true)
    setMessage('')
    try {
      await api('POST', `${roomPath(me.roomCode)}/answers`, { sessionId: me.sessionId, optionIndex })
      setAccepted(true)
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      setMessage(e instanceof ApiError ? e.message : '')
      if (code === 'ALREADY_ANSWERED') {
        setChoice(null)
        setAccepted(true)
        void sync.snapshot()
      } else if (code === 'NOT_IN_ROOM' || code === 'ROOM_NOT_FOUND') setPhase('gone')
      else if (code === 'QUESTION_CLOSED') setChoice(null)
      else {
        setChoice(null)
        setLocked(false)
      }
    }
  }

  const myRow = leaderboard.find((r) => r.playerId === me.participantId)
  const finalRow = scoreboard.find((r) => r.playerId === me.participantId)
  const points = (n: number) => `${n} point${n === 1 ? '' : 's'}`
  const long = fontScale >= 1.3 || (question?.options.some((o) => o.length > 60) ?? false)
  const gone = phase === 'gone'
  const notice = (
    <Appear key={message} style={[g.notice, gone ? card(t) : { backgroundColor: t.accentTint }]}>
      {gone ? <View style={[g.noticeBar, { backgroundColor: t.error }]} /> : null}
      <Text style={[s.subhead, { color: t.label }]} accessibilityRole="alert">
        {message}
      </Text>
    </Appear>
  )

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: t.background }]}>
      <View style={g.bar}>
        <Text style={[s.footnote, s.grow, { color: t.secondary }]} numberOfLines={1}>
          {me.nickname} {'·'} Room {me.roomCode}
        </Text>
        {phase !== 'ended' && !gone ? <Pill state={link} /> : null}
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        {message && phase !== 'question' ? notice : null}

        {phase === 'loading' ? <LargeTitle subtitle="Getting the game…">Joining</LargeTitle> : null}

        {gone ? (
          <>
            <LargeTitle subtitle="This room no longer exists. Scores are saved if the game finished.">Game unavailable</LargeTitle>
            <Button title="Join another game" onPress={onLeave} />
          </>
        ) : null}

        {phase === 'lobby' || phase === 'waiting' ? (
          <>
            {phase === 'lobby' ? (
              <LargeTitle subtitle="Waiting for the host to start the game.">You're in!</LargeTitle>
            ) : (
              <LargeTitle subtitle={`The game is on${questionCount ? ` with ${questionCount} question${questionCount === 1 ? '' : 's'}` : ''}. The next question is coming up.`}>Get ready</LargeTitle>
            )}
            <Group>
              <Row first>
                <View style={g.line} accessible accessibilityLabel={`Room code ${me.roomCode.split('').join(' ')}`}>
                  <Text style={[s.body, s.grow, { color: t.secondary }]}>Room code</Text>
                  <Text style={[s.title2, g.code, { color: t.label }]}>{me.roomCode}</Text>
                </View>
              </Row>
              <Row>
                <View style={g.line}>
                  <Text style={[s.body, s.grow, { color: t.secondary }]}>Playing as</Text>
                  <Text style={[s.headline, { color: t.label }]}>{me.nickname}</Text>
                </View>
              </Row>
            </Group>
            <Group header={`Players · ${participants.length}`}>
              {participants.length === 0 ? (
                <Row first>
                  <Text style={[s.body, { color: t.secondary }]}>No players yet.</Text>
                </Row>
              ) : (
                participants.map((p, i) => (
                  <Row key={p.participantId} first={i === 0}>
                    <View style={g.line} accessible accessibilityLabel={`${p.nickname}${p.participantId === me.participantId ? ', you' : ''}, ${p.connected ? 'connected' : 'away'}`}>
                      <View style={[g.dot, p.connected ? { backgroundColor: t.success } : { borderWidth: 1.5, borderColor: t.secondary }]} />
                      <Text style={[s.body, s.grow, { color: t.label }]} numberOfLines={1}>
                        {p.nickname}
                        {p.participantId === me.participantId ? <Text style={{ color: t.accent, fontWeight: '600' }}>  You</Text> : null}
                      </Text>
                      <Text style={[s.footnote, { color: t.secondary }]}>{p.connected ? 'Connected' : 'Away'}</Text>
                    </View>
                  </Row>
                ))
              )}
            </Group>
          </>
        ) : null}

        {phase === 'question' && question ? (
          <>
            <Appear key={question.index} style={s.titleBlock}>
              <View style={[g.counter, { backgroundColor: t.fill }]}>
                <Text style={[s.subhead, g.counterText, { color: t.label }]}>
                  Question {question.index + 1}
                  {questionCount ? ` of ${questionCount}` : ''}
                </Text>
              </View>
              <Text style={[s.title1, { color: t.label }]} accessibilityRole="header">
                {question.text}
              </Text>
            </Appear>

            {message ? notice : null}

            <View style={g.tiles} accessibilityRole="radiogroup" accessibilityLabel="Answers">
              {question.options.map((option, i) => {
                const correct = revealed && reveal.correctIndex === i
                const wrongPick = revealed && accepted && choice === i && !correct
                const chosen = choice === i
                const mode: Mode = correct ? 'correct' : wrongPick ? 'wrong' : (locked || revealed) && !chosen ? 'receded' : chosen ? 'chosen' : 'idle'
                const tag = correct ? '✓ Correct answer' : wrongPick ? '✕ Your answer' : chosen ? (accepted ? 'Locked in' : 'Sending…') : ''
                const speech = correct ? (chosen ? 'Your answer, correct' : 'Correct answer') : wrongPick ? 'Your answer' : chosen ? (accepted ? 'Your answer, locked in' : 'Sending') : ''
                return (
                  <Tile
                    key={i}
                    index={i}
                    option={option}
                    mode={mode}
                    chosen={chosen}
                    tag={tag}
                    speech={speech}
                    lockedIn={chosen && accepted}
                    disabled={locked}
                    long={long}
                    entryKey={question.index}
                    reduced={reduced}
                    onPress={() => answer(i)}
                  />
                )
              })}
            </View>

            {revealed && outcome ? (
              <OutcomeCard outcome={outcome} correctIndex={reveal.correctIndex} />
            ) : (
              <Text style={[s.subhead, g.status, { color: t.secondary }]} accessibilityLiveRegion="polite">
                {accepted ? 'Locked in. Waiting for the host to close answering.' : null}
                {!accepted && locked && choice !== null && !message ? 'Sending your answer…' : null}
                {!locked ? "Pick one answer. You can't change it after you tap." : null}
                {locked && !accepted && choice === null ? 'Answering is closed. Waiting for the results.' : null}
              </Text>
            )}

            {revealed && reveal.explanation ? (
              <Appear delay={120}>
                <Group header="Explanation">
                  <Row first>
                    <Text style={[s.body, { color: t.label }]}>{reveal.explanation}</Text>
                  </Row>
                </Group>
              </Appear>
            ) : null}

            {revealed && myRow ? (
              <Appear delay={240}>
                <Group>
                  <Row first>
                    <View style={g.line}>
                      <Text style={[s.body, s.grow, { color: t.secondary }]}>Your rank</Text>
                      <Text style={[s.title2, s.tabular, { color: t.label }]}>#{myRow.rank}</Text>
                    </View>
                  </Row>
                  <Row>
                    <View style={g.line}>
                      <Text style={[s.body, s.grow, { color: t.secondary }]}>Score</Text>
                      <Text style={[s.headline, s.tabular, { color: t.label }]}>{points(myRow.score)}</Text>
                    </View>
                  </Row>
                </Group>
              </Appear>
            ) : null}

            {revealed ? <Board rows={leaderboard} me={me.participantId} title="Leaderboard" deltas={deltas} /> : null}
          </>
        ) : null}

        {phase === 'ended' ? (
          <>
            <LargeTitle subtitle={finalRow ? `You finished ${ordinal(finalRow.rank)} with ${points(finalRow.score)}.` : 'Thanks for playing!'}>Game over</LargeTitle>
            <Podium rows={scoreboard} animate={endedLive} />
            {scoreboard.length > 0 ? <Board rows={scoreboard} me={me.participantId} title="Final scoreboard" /> : null}
            <Button title="Join another game" onPress={onLeave} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Tile({
  index,
  option,
  mode,
  chosen,
  tag,
  speech,
  lockedIn,
  disabled,
  long,
  entryKey,
  reduced,
  onPress,
}: {
  index: number
  option: string
  mode: Mode
  chosen: boolean
  tag: string
  speech: string
  lockedIn: boolean
  disabled: boolean
  long: boolean
  entryKey: number
  reduced: boolean
  onPress: () => void
}) {
  const t = useTheme()
  const a = ANSWERS[index % 4]
  const enter = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(1)).current
  const down = useRef(new Animated.Value(0)).current

  useEffect(() => {
    enter.setValue(0)
    const anim = reduced ? fade(enter, 1) : spring(enter, 1, SPRING.content, index * 40)
    anim.start()
    return () => anim.stop()
  }, [entryKey])

  useEffect(() => {
    if (reduced) return scale.setValue(1)
    if (mode === 'receded' || mode === 'wrong') Animated.timing(scale, { toValue: 0.97, duration: 240, easing: Easing.out(Easing.ease), useNativeDriver: true }).start()
    else if (mode === 'correct') Animated.sequence([Animated.timing(scale, { toValue: 1.03, duration: 120, easing: Easing.out(Easing.ease), useNativeDriver: true }), spring(scale, 1, SPRING.lock)]).start()
    else spring(scale, 1, SPRING.release).start()
  }, [mode, reduced])

  useEffect(() => {
    if (!lockedIn || reduced || mode !== 'chosen') return
    scale.setValue(0.96)
    spring(scale, 1, SPRING.lock).start()
  }, [lockedIn])

  const receded = mode === 'receded' || mode === 'wrong'
  const ring = mode === 'chosen' || mode === 'correct' || mode === 'wrong'
  const fg = receded ? t.secondary : a.text
  const ink = a.text !== '#FFFFFF'
  const entryScale = reduced ? 1 : enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] })
  const translateY = down.interpolate({ inputRange: [0, 1], outputRange: [0, 3] })
  const faceScale = down.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] })

  return (
    <Pressable
      style={[g.slot, long && g.slotLong]}
      onPress={onPress}
      onPressIn={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        if (!reduced) press(down, 1).start()
      }}
      onPressOut={() => reduced || spring(down, 0, SPRING.release).start()}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={`Answer ${a.letter}, ${a.name}: ${option}${speech ? `. ${speech}` : ''}`}
      accessibilityState={{ selected: chosen, checked: chosen, disabled }}
    >
      {({ pressed }) => (
        <Animated.View style={[g.tile, { opacity: enter, transform: [{ scale: entryScale }, { scale }] }]}>
          {ring ? <View style={[g.ring, { borderColor: t.label }]} /> : null}
          <View style={[g.plinth, { backgroundColor: receded ? 'transparent' : a.plinth }]}>
            <Animated.View
              style={[
                g.face,
                receded ? { backgroundColor: t.card, borderWidth: 1, borderColor: t.controlBorder } : { backgroundColor: a.face },
                reduced && pressed ? { opacity: 0.85 } : null,
                { transform: [{ translateY }, { scale: faceScale }] },
              ]}
            >
              <View style={g.tileTop}>
                <View style={[g.badge, { backgroundColor: receded ? a.face : ink ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.18)' }]}>
                  <Text style={[g.badgeText, { color: a.text }]}>{a.letter}</Text>
                </View>
                <Text style={[g.shape, { color: fg }]}>{a.shape}</Text>
              </View>
              <Text style={[g.option, { color: fg }]}>{option}</Text>
              {tag ? (
                <Appear key={tag} style={[g.tag, { backgroundColor: receded ? t.fill : ink ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.3)' }]}>
                  <Text style={[s.footnote, g.tagText, { color: receded ? t.label : a.text }]}>{tag}</Text>
                </Appear>
              ) : null}
            </Animated.View>
          </View>
        </Animated.View>
      )}
    </Pressable>
  )
}

function outcomeCopy(outcome: Outcome, correctIndex: number) {
  const a = ANSWERS[correctIndex % 4]
  if (outcome === 'right') return { icon: '✓', title: 'Correct! You earned 1 point.', speech: 'Correct! You earned 1 point.' }
  if (outcome === 'wrong') return { icon: '✕', title: `Not this time. The answer was ${a.letter} ${a.shape}.`, speech: `Not this time. The answer was ${a.letter}, ${a.name}.` }
  if (outcome === 'first') return { icon: '✓', title: 'Your first answer counted.', speech: 'Your first answer counted.' }
  return { icon: '–', title: "You didn't answer this one.", speech: "You didn't answer this one." }
}

function OutcomeCard({ outcome, correctIndex }: { outcome: Outcome; correctIndex: number }) {
  const t = useTheme()
  const { icon, title, speech } = outcomeCopy(outcome, correctIndex)
  const color = outcome === 'right' ? t.success : outcome === 'wrong' ? t.error : outcome === 'first' ? t.accent : t.secondary
  return (
    <Appear style={[g.outcome, card(t)]}>
      <View accessible accessibilityRole="alert" accessibilityLabel={speech} style={g.line}>
        <View style={[g.outcomeIcon, { borderColor: color }]}>
          <Text style={[g.outcomeIconText, { color }]}>{icon}</Text>
        </View>
        <Text style={[s.headline, s.grow, { color: t.label }]}>{title}</Text>
      </View>
    </Appear>
  )
}

const g = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 44 },
  notice: { padding: 16, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden', marginTop: 8, marginBottom: 8 },
  noticeBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { letterSpacing: 3, fontVariant: ['tabular-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  counter: { alignSelf: 'flex-start', paddingHorizontal: 12, minHeight: 28, justifyContent: 'center', borderRadius: 999 },
  counterText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 16, paddingTop: 6 },
  slot: { flexBasis: '45%', flexGrow: 1 },
  slotLong: { flexBasis: '100%' },
  tile: { flex: 1 },
  ring: { position: 'absolute', top: -6, left: -6, right: -6, bottom: -6, borderWidth: 3, borderRadius: 30, borderCurve: 'continuous' },
  plinth: { flex: 1, borderRadius: 24, borderCurve: 'continuous', paddingBottom: 4 },
  face: { flex: 1, minHeight: 128, borderRadius: 24, borderCurve: 'continuous', padding: 16, gap: 10 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { width: 28, height: 28, borderRadius: 6, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 15, fontWeight: '700' },
  shape: { fontSize: 20 },
  option: { fontSize: 19, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2, flexGrow: 1 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderCurve: 'continuous' },
  tagText: { fontWeight: '700' },
  status: { textAlign: 'center', marginBottom: 24, minHeight: 20 },
  outcome: { padding: 16, borderRadius: 20, borderCurve: 'continuous', marginBottom: 24 },
  outcomeIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  outcomeIconText: { fontSize: 18, fontWeight: '700' },
})
