import type { QuizDeck, QuizIdeaSuggestion } from '../types/quiz';
import { createNewCard } from '../utils/spacedRepetition';

export function buildSeedDecks(now: Date = new Date()): QuizDeck[] {
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000).toISOString();
  const yesterday = new Date(now.getTime() - 1 * 86400_000).toISOString();
  const tomorrow = new Date(now.getTime() + 1 * 86400_000).toISOString();
  const inFourDays = new Date(now.getTime() + 4 * 86400_000).toISOString();

  return [
    {
      id: 'deck-memory-science',
      title: 'Memory & Neuroplasticity',
      description:
        'Master the cognitive psychology behind spaced repetition, active recall, and memory consolidation.',
      subject: 'Cognitive Science',
      createdAt: twoDaysAgo,
      cards: [
        {
          ...createNewCard(
            {
              id: 'mem-1',
              prompt:
                'Which cognitive phenomenon explains why retrieving an answer from memory strengthens recall far more than re-reading notes?',
              answer: 'The Testing Effect',
              distractors: [
                'Serial Position Bias',
                'Echoic Decay',
                'Chunking Overload',
              ],
              acceptableAnswers: ['testing effect', 'retrieval practice'],
              hint: 'Think about what quizzes actively force your brain to do.',
              explanation:
                'Roediger & Karpicke (2006) showed active retrieval strengthens synaptic pathways far better than passive re-reading.',
              conceptTag: 'Active Recall',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'mem-2',
              prompt:
                'Who discovered the exponential Forgetting Curve in 1885 by testing himself on nonsense syllables?',
              answer: 'Hermann Ebbinghaus',
              distractors: ['Wilhelm Wundt', 'Ivan Pavlov', 'Donald Hebb'],
              acceptableAnswers: ['ebbinghaus'],
              hint: 'His last name starts with E and gave the forgetting curve its name.',
              explanation:
                'Hermann Ebbinghaus quantified how memory decays exponentially over time unless interrupted by spaced reviews.',
              conceptTag: 'Forgetting Curve',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'mem-3',
              prompt:
                'In the SM-2 algorithm, what does the Ease Factor (EF) determine for each flashcard?',
              answer: 'How fast the review interval multiplies after each successful recall',
              distractors: [
                'How many multiple-choice distractors appear',
                'The maximum number of cards studied per day',
                'The font size shown during night mode',
              ],
              acceptableAnswers: ['interval multiplier', 'how fast interval grows'],
              hint: 'Easier cards jump further into the future than harder cards.',
              explanation:
                'SM-2 multiplies the current interval by the card-specific Ease Factor (starting at 2.5) so easy items space out rapidly.',
              conceptTag: 'SM-2 Algorithm',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'mem-4',
              prompt:
                'What term did Robert Bjork coin for study strategies that feel harder in the moment yet yield stronger long-term retention?',
              answer: 'Desirable Difficulties',
              distractors: [
                'Cognitive Dissonance',
                'Sensory Adaptation',
                'Iconic Buffering',
              ],
              acceptableAnswers: ['desirable difficulty'],
              hint: 'Effortful retrieval is actually "desirable" for memory.',
              explanation:
                'Desirable difficulties—like spacing, interleaving, and active testing—slow initial fluency but dramatically raise durable learning.',
              conceptTag: 'Desirable Difficulty',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'mem-5',
              prompt:
                'Which brain structure acts as a temporary index that transfers declarative memories to the neocortex during sleep?',
              answer: 'Hippocampus',
              distractors: ['Cerebellum', 'Brainstem', 'Thalamus'],
              acceptableAnswers: ['the hippocampus'],
              hint: 'Named after the Greek word for seahorse.',
              explanation:
                'During slow-wave sleep, the hippocampus replays neural patterns to consolidate facts into distributed neocortical networks.',
              conceptTag: 'Consolidation',
            },
            now
          ),
          easeFactor: 2.65,
          interval: 4,
          repetitions: 2,
          lastReviewedAt: twoDaysAgo,
          dueDate: tomorrow,
          state: 'review',
        },
        {
          ...createNewCard(
            {
              id: 'mem-6',
              prompt:
                'Mixing different problem types within one study session rather than practicing one skill in a block is called what?',
              answer: 'Interleaving',
              distractors: ['Cramming', 'Massed Practice', 'Shadowing'],
              acceptableAnswers: ['interleaved practice'],
              hint: 'Think of weaving threads together instead of stacking blocks.',
              explanation:
                'Interleaving forces the learner to identify which strategy applies to each problem, improving discrimination and transfer.',
              conceptTag: 'Interleaving',
            },
            now
          ),
          easeFactor: 2.5,
          interval: 6,
          repetitions: 2,
          lastReviewedAt: yesterday,
          dueDate: inFourDays,
          state: 'review',
        },
      ],
    },
    {
      id: 'deck-meadow-botany',
      title: 'Botany & Meadow Ecology',
      description:
        'Explore how clovers, grasses, and wildflowers capture sunlight and nourish living meadow ecosystems.',
      subject: 'Biology',
      createdAt: twoDaysAgo,
      cards: [
        {
          ...createNewCard(
            {
              id: 'bot-1',
              prompt:
                'Which symbiotic bacteria live in white clover root nodules to convert atmospheric nitrogen into plant-usable ammonia?',
              answer: 'Rhizobium',
              distractors: ['Lactobacillus', 'Streptococcus', 'Cyanobacteria'],
              acceptableAnswers: ['rhizobia'],
              hint: 'Its root starts with "Rhizo-", Greek for root.',
              explanation:
                'Rhizobium bacteria partner with legumes like clover to fix atmospheric N2, naturally enriching meadow soil.',
              conceptTag: 'Nitrogen Fixation',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'bot-2',
              prompt:
                'Which vascular tissue transports dissolved sugars from sunlit leaves down to growing roots?',
              answer: 'Phloem',
              distractors: ['Xylem', 'Epidermis', 'Stomata'],
              acceptableAnswers: ['phloem tissue'],
              hint: 'Remember: Phloem flows "food" down and around.',
              explanation:
                'Phloem carries sucrose and amino acids via pressure flow from source leaves to metabolic sinks.',
              conceptTag: 'Plant Vascularity',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'bot-3',
              prompt:
                'What microscopic pores on the underside of grass blades open to absorb CO2 for photosynthesis?',
              answer: 'Stomata',
              distractors: ['Chloroplasts', 'Lenticels', 'Trichomes'],
              acceptableAnswers: ['stoma'],
              hint: 'Flanked by a pair of guard cells.',
              explanation:
                'Guard cells regulate stomatal opening to balance CO2 uptake against water vapor transpiration.',
              conceptTag: 'Gas Exchange',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'bot-4',
              prompt:
                'Why does meadow grass quickly regrow even after being nibbled or mowed from the top?',
              answer: 'Its meristematic growth zone sits near the base of the blade',
              distractors: [
                'It absorbs chlorophyll directly from soil fungi',
                'Its flowers turn back into roots overnight',
                'Grass blades lack cell walls',
              ],
              acceptableAnswers: ['basal meristem', 'intercalary meristem'],
              hint: 'Unlike trees that grow from tips, grass grows from down low.',
              explanation:
                'Grass evolved basal intercalary meristems protected near ground level, letting blades recover rapidly after grazing.',
              conceptTag: 'Plant Adaptation',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'bot-5',
              prompt:
                'In photosynthesis, which light-absorbing pigment reflects green wavelengths while capturing red and blue photons?',
              answer: 'Chlorophyll a',
              distractors: ['Carotene', 'Anthocyanin', 'Melanin'],
              acceptableAnswers: ['chlorophyll'],
              hint: 'Gives meadows their signature emerald tint.',
              explanation:
                'Chlorophyll absorbs blue (~430nm) and red (~660nm) light to drive electron transport, reflecting green light.',
              conceptTag: 'Photosynthesis',
            },
            now
          ),
          easeFactor: 2.5,
          interval: 1,
          repetitions: 1,
          lastReviewedAt: yesterday,
          dueDate: now.toISOString(),
          state: 'review',
        },
      ],
    },
    {
      id: 'deck-japanese-meadow',
      title: 'Everyday Japanese Essentials',
      description:
        'Charming beginner Japanese vocabulary and expressions for cozy daily life and gentle encouragement.',
      subject: 'Languages',
      createdAt: yesterday,
      cards: [
        {
          ...createNewCard(
            {
              id: 'jp-1',
              prompt: 'What does the Japanese word "Kusa" (草 / くさ) mean in English?',
              answer: 'Grass',
              distractors: ['Cloud', 'River', 'Starlight'],
              acceptableAnswers: ['grass', 'meadow grass'],
              hint: 'The theme of our peaceful study backdrop!',
              explanation:
                '草 (kusa) means grass or herb—and in cozy countryside scenes, it evokes fresh sunlit meadows.',
              conceptTag: 'Nature Vocab',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'jp-2',
              prompt: 'How do you cheer someone on with "Do your best!" in polite everyday Japanese?',
              answer: 'Ganbatte (頑張って)',
              distractors: [
                'Oyasumi (おやすみ)',
                'Sumimasen (すみません)',
                'Itadakimasu (いただきます)',
              ],
              acceptableAnswers: ['ganbatte', 'ganbatte kudasai', '頑張って'],
              hint: 'Starts with "Gan-" and means hang in there / give it your best.',
              explanation:
                '頑張って (ganbatte) is a warm encouragement used before exams, study sessions, or small daily challenges.',
              conceptTag: 'Encouragement',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'jp-3',
              prompt: 'What does "Yotsuba no kuroobaa" (四つ葉のクローバー) refer to?',
              answer: 'Four-leaf clover',
              distractors: ['Cherry blossom', 'Morning dew', 'Paper lantern'],
              acceptableAnswers: ['a four leaf clover', '4 leaf clover'],
              hint: '"Yotsu" means four, and "ha/ba" means leaf.',
              explanation:
                '四つ葉のクローバー symbolizes rare good fortune—just like locking a tough concept into long-term memory!',
              conceptTag: 'Nature Vocab',
            },
            now
          ),
        },
        {
          ...createNewCard(
            {
              id: 'jp-4',
              prompt: 'Which Japanese phrase is used to warmly say "Good job / Thank you for your hard work"?',
              answer: 'Otsukaresama (お疲れ様)',
              distractors: [
                'Ohayou (おはよう)',
                'Sayounara (さようなら)',
                'Konbanwa (こんばんは)',
              ],
              acceptableAnswers: ['otsukaresama', 'otsukaresama desu'],
              hint: 'Said when someone finishes a study session or shift.',
              explanation:
                'お疲れ様 (otsukaresama) acknowledges effort and dedication after completing work or study.',
              conceptTag: 'Daily Phrases',
            },
            now
          ),
        },
      ],
    },
  ];
}

export const CURATED_QUIZ_IDEAS: QuizIdeaSuggestion[] = [
  {
    title: 'Organic Chemistry Functional Groups',
    subject: 'Chemistry',
    promptTopic: 'Key organic chemistry functional groups, polarity, and characteristic reactions for university exams',
    whyItWorks: 'Visual structure-to-property links respond strongly to spaced retrieval.',
  },
  {
    title: 'Cellular Respiration & ATP Yield',
    subject: 'Biology',
    promptTopic: 'Glycolysis, Krebs cycle, and oxidative phosphorylation steps and energy outputs',
    whyItWorks: 'Sequenced biochemical pathways benefit from hint-scaffolded active recall.',
  },
  {
    title: 'World History: Silk Road Exchanges',
    subject: 'History',
    promptTopic: 'Trade goods, cultural diffusion, empires, and technologies along the Silk Road',
    whyItWorks: 'Interleaved cause-and-effect prompts prevent rote date memorization.',
  },
  {
    title: 'SQL Joins & Relational Indexing',
    subject: 'Computer Science',
    promptTopic: 'INNER vs LEFT JOIN behavior, B-tree indexes, normalization, and query planning',
    whyItWorks: 'Contrastive distractors sharpen edge-case recognition.',
  },
];
