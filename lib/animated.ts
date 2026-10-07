import { Animated } from 'react-native';
import { cssInterop } from 'nativewind';

cssInterop(Animated.View, { className: 'style' });

export const AnimatedView = Animated.View;
