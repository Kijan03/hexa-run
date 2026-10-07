import './lib/polyfills';
import './global.css';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './lib/supabase';
import MainMapScreen from './screens/MainMapScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import { COLORS } from './constants/theme';
import type { Team, User } from './types';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 익명 로그인 + 기존 크루 조회
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        let uid = sessionData.session?.user.id ?? null;
        if (!uid) {
          const { data, error: authError } = await supabase.auth.signInAnonymously();
          if (authError) throw authError;
          uid = data.user?.id ?? null;
        }
        if (!uid) throw new Error('로그인에 실패했습니다.');

        const { data: row, error: selError } = await supabase
          .from('users')
          .select('id, team')
          .eq('id', uid)
          .maybeSingle();
        if (selError) throw selError;

        if (!cancelled) {
          setUserId(uid);
          setTeam((row as Pick<User, 'id' | 'team'> | null)?.team ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View className="flex-1 items-center justify-center p-6">
        <ActivityIndicator color={COLORS.text} />
      </View>
    );
  } else if (!userId) {
    body = (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="mb-2 text-4xl font-black tracking-widest text-white">HEXA RUN</Text>
        <Text className="mt-4 text-center text-sm text-pulse">
          {error ?? '로그인할 수 없습니다.'}
        </Text>
      </View>
    );
  } else if (!team) {
    body = <OnboardingScreen userId={userId} onComplete={setTeam} />;
  } else {
    body = <MainMapScreen team={team} />;
  }

  return (
    <View className="flex-1 bg-bg">
      <StatusBar style="light" />
      {body}
    </View>
  );
}
