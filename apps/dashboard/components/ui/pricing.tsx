'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CheckCircleIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { motion, Transition } from 'framer-motion';

// 21st.dev pricing section, recolored to this project's lime `accent` / `ink`
// surface / `zinc` text tokens (the shadcn `--primary`/`--muted`/`--foreground`
// variables aren't defined here). Structure & animations are unchanged.

type FREQUENCY = 'monthly' | 'yearly';
const frequencies: FREQUENCY[] = ['monthly', 'yearly'];

interface Plan {
	name: string;
	info: string;
	price: {
		monthly: number;
		yearly: number;
	};
	features: {
		text: string;
		tooltip?: string;
	}[];
	btn: {
		text: string;
		href: string;
	};
	highlighted?: boolean;
}

interface PricingSectionProps extends React.ComponentProps<'div'> {
	plans: Plan[];
	heading: string;
	description?: string;
}

export function PricingSection({
	plans,
	heading,
	description,
	...props
}: PricingSectionProps) {
	const [frequency, setFrequency] = React.useState<'monthly' | 'yearly'>(
		'monthly',
	);

	return (
		<div
			className={cn(
				'flex w-full flex-col items-center justify-center space-y-5 p-4',
				props.className,
			)}
			{...props}
		>
			<div className="mx-auto max-w-xl space-y-2">
				<h2 className="text-center text-2xl font-bold tracking-tight text-zinc-900 md:text-3xl lg:text-4xl dark:text-zinc-100">
					{heading}
				</h2>
				{description && (
					<p className="text-center text-sm text-zinc-500 md:text-base dark:text-zinc-400">
						{description}
					</p>
				)}
			</div>
			<PricingFrequencyToggle
				frequency={frequency}
				setFrequency={setFrequency}
			/>
			<div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-3">
				{plans.map((plan) => (
					<PricingCard plan={plan} key={plan.name} frequency={frequency} />
				))}
			</div>
		</div>
	);
}

type PricingFrequencyToggleProps = React.ComponentProps<'div'> & {
	frequency: FREQUENCY;
	setFrequency: React.Dispatch<React.SetStateAction<FREQUENCY>>;
};

export function PricingFrequencyToggle({
	frequency,
	setFrequency,
	...props
}: PricingFrequencyToggleProps) {
	return (
		<div
			className={cn(
				'mx-auto flex w-fit rounded-full border border-ink-700 bg-ink-800/60 p-1',
				props.className,
			)}
			{...props}
		>
			{frequencies.map((freq) => (
				<button
					key={freq}
					onClick={() => setFrequency(freq)}
					className={cn(
						'relative px-4 py-1 text-sm capitalize transition-colors',
						frequency === freq
							? 'text-zinc-950'
							: 'text-zinc-500 dark:text-zinc-400',
					)}
				>
					<span className="relative z-10">{freq}</span>
					{frequency === freq && (
						<motion.span
							layoutId="frequency"
							transition={{ type: 'spring', duration: 0.4 }}
							className="absolute inset-0 z-0 rounded-full bg-accent-500"
						/>
					)}
				</button>
			))}
		</div>
	);
}

type PricingCardProps = React.ComponentProps<'div'> & {
	plan: Plan;
	frequency?: FREQUENCY;
};

export function PricingCard({
	plan,
	className,
	frequency = frequencies[0],
	...props
}: PricingCardProps) {
	return (
		<div
			key={plan.name}
			className={cn(
				'relative flex w-full flex-col rounded-lg border border-ink-700 bg-ink-900',
				className,
			)}
			{...props}
		>
			{plan.highlighted && (
				<BorderTrail
					className="bg-accent-500"
					style={{
						boxShadow:
							'0px 0px 60px 30px rgb(214 255 102 / 35%), 0 0 100px 60px rgb(0 0 0 / 30%), 0 0 140px 90px rgb(0 0 0 / 30%)',
					}}
					size={100}
				/>
			)}
			<div
				className={cn(
					'rounded-t-lg border-b border-ink-700 bg-ink-800/40 p-4',
					plan.highlighted && 'bg-ink-800/70',
				)}
			>
				<div className="absolute top-2 right-2 z-10 flex items-center gap-2">
					{plan.highlighted && (
						<p className="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-xs text-zinc-900 dark:text-zinc-100">
							<StarIcon className="h-3 w-3 fill-current text-accent-600 dark:text-accent-400" />
							Popular
						</p>
					)}
					{frequency === 'yearly' && plan.price.monthly > 0 && (
						<p className="flex items-center gap-1 rounded-md border border-transparent bg-accent-500 px-2 py-0.5 text-xs text-zinc-950">
							{Math.round(
								((plan.price.monthly * 12 - plan.price.yearly) /
									plan.price.monthly /
									12) *
									100,
							)}
							% off
						</p>
					)}
				</div>

				<div className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
					{plan.name}
				</div>
				<p className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
					{plan.info}
				</p>
				<h3 className="mt-2 flex items-end gap-1">
					<span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
						${plan.price[frequency]}
					</span>
					<span className="text-zinc-500 dark:text-zinc-400">
						{plan.name !== 'Free'
							? '/' + (frequency === 'monthly' ? 'month' : 'year')
							: ''}
					</span>
				</h3>
			</div>
			<div
				className={cn(
					'space-y-4 px-4 py-6 text-sm text-zinc-600 dark:text-zinc-300',
					plan.highlighted && 'bg-ink-800/30',
				)}
			>
				{plan.features.map((feature, index) => (
					<div key={index} className="flex items-center gap-2">
						<CheckCircleIcon className="h-4 w-4 text-accent-600 dark:text-accent-400" />
						<TooltipProvider>
							<Tooltip delayDuration={0}>
								<TooltipTrigger asChild>
									<p
										className={cn(
											feature.tooltip &&
												'cursor-pointer border-b border-dashed border-ink-500',
										)}
									>
										{feature.text}
									</p>
								</TooltipTrigger>
								{feature.tooltip && (
									<TooltipContent>
										<p>{feature.tooltip}</p>
									</TooltipContent>
								)}
							</Tooltip>
						</TooltipProvider>
					</div>
				))}
			</div>
			<div
				className={cn(
					'mt-auto w-full border-t border-ink-700 p-3',
					plan.highlighted && 'bg-ink-800/70',
				)}
			>
				<Button
					className="w-full"
					variant={plan.highlighted ? 'default' : 'outline'}
					asChild
				>
					<Link href={plan.btn.href}>{plan.btn.text}</Link>
				</Button>
			</div>
		</div>
	);
}

type BorderTrailProps = {
	className?: string;
	size?: number;
	transition?: Transition;
	delay?: number;
	onAnimationComplete?: () => void;
	style?: React.CSSProperties;
};

export function BorderTrail({
	className,
	size = 60,
	transition,
	delay,
	onAnimationComplete,
	style,
}: BorderTrailProps) {
	const BASE_TRANSITION: Transition = {
		repeat: Infinity,
		duration: 5,
		ease: 'linear',
	};

	return (
		<div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]">
			<motion.div
				className={cn('absolute aspect-square bg-accent-500', className)}
				style={{
					width: size,
					offsetPath: `rect(0 auto auto 0 round ${size}px)`,
					...style,
				}}
				animate={{
					offsetDistance: ['0%', '100%'],
				}}
				transition={{
					...(transition ?? BASE_TRANSITION),
					delay: delay,
				}}
				onAnimationComplete={onAnimationComplete}
			/>
		</div>
	);
}
