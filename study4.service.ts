import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ReadingTestDto } from './dto/reading-test.dto';

import axiosRetry from 'axios-retry';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ReadingParseError } from './error';
import { ReadingEntity } from './entities/reading.entity';
import { QuestionGroupEntity } from './entities/reading-question-group.entity';
import { QuestionEntity } from './entities/reading-question.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, InsertResult,  QueryRunner, Repository } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as fs from 'fs';
import { ListeningEntity } from './entities/listening.entity';
import { ListeningQuestionGroupEntity } from './entities/listening-question-group.entity';
import { ListeningQuestionEntity } from './entities/listening-question.entity';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import { url } from 'inspector';



axios.get('https://study4.com/tests/2010/practice/?part=6018', {
  timeout: 10000  // Tăng thời gian chờ lên 10 giây
})
  .then(response => {
    console.log(response.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });
axiosRetry(axios, {
  retries: 3, // Số lần thử lại
  retryDelay: (retryCount) => retryCount * 2000, // Tăng dần thời gian chờ
  retryCondition: (error) => axiosRetry.isNetworkError(error) || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT',
});


export interface QuestionForm {
  questionGroups: QuestionGroup[];
}

export interface QuestionGroup {
  context?: string; // Optional context or introduction for the group
  questions: Question[];
  totalQuestions: number;
}

export interface Question {
  id: string; // Unique identifier for the question
  number: number; // Question number
  type: 'text' | 'radio'; // Type of the question (text input or multiple choice)
  text: string; // The question text
  options?: RadioOption[]; // Options for radio type questions (if applicable)
  answer?: string; // User's input or selected answer
}

export interface RadioOption {
  value: string; // Value of the option (e.g., "TRUE", "FALSE", "NOT GIVEN")
  label: string; // Label for the option (e.g., "TRUE", "FALSE", "NOT GIVEN")
}

@Injectable()
export class Study4Service {
  private readonly baseUrl = 'https://study4.com';
  saveListeningTestToDatabase: any;
  constructor(
    @InjectRepository(ReadingEntity)
    private readingTestRepository: Repository<ReadingEntity>,
    @InjectRepository(QuestionGroupEntity)
    private questionGroupRepository: Repository<QuestionGroupEntity>,
    @InjectRepository(QuestionEntity)
    private questionRepository: Repository<QuestionEntity>,

    @InjectPinoLogger()
    private logger: PinoLogger,
  ) {
    // Configure axios retry with exponential backoff
    axiosRetry(axios, {
      retries: 10, // number of retries
      retryDelay: axiosRetry.exponentialDelay, // exponential backoff
      retryCondition: (error) => {
        // Retry on network errors or 5xx status codes
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          axiosRetry.isRetryableError(error) ||
          (error.response &&
            (error.response.status >= 500 || error.response.status === 429))
        );
      },
      onRetry: (retryCount, error) => {
        this.logger.warn(
          {
            retryCount,
            url: error.config.url,
            message: error.message,
          },
          'Retrying axios request',
        );
      },
    });
  }

  async crawlReadingTest(_sessionId: string, _csrfToken: string) {
    let page = 1;
    const sessionId = _sessionId || 'nxz0jqtvofig5m0rv0tc26q2qftakuc6';
    const csrfToken =
      _csrfToken ||
      '33Itcf79rUSXy6lC4RpYyTQtC3ESgEwfaSDnaFwC9IJMUTMLKQkIoraakqVpvQ1u';
    this.logger.info({ sessionId }, 'crawl reading test');
    while (true) {
      const listReading = await this.parseListReadingTest(
        `https://study4.com/tests/ielts/?term=reading&page=${page}`,
        { sessionId, csrfToken },
      );

      if (listReading.length === 0) {
        this.logger.info('End crawl reading. No more pages');
        break;
      }

      for (const result of listReading) {
        const linkTest = result.link;
        const splitLink = linkTest.split('/');
        const sliceArr = splitLink.slice(0, splitLink.length - 2);
        const readingId = sliceArr[sliceArr.length - 1];
        const linkWithId = sliceArr.join('/');
        const parts = await this.parseReadingTestWithParts({
          linkTest: linkTest,
          sessionId,
        });

        await new Promise((resolve) => setTimeout(resolve, 2000));
        const listPartIds = parts.map((item) => item.partId);
        const practiceLink = `${linkWithId}/practice/?part=${
          listPartIds[0]
        }&part=${listPartIds.slice(1, listPartIds.length).join('&part=')}`;
        this.logger.info({ practiceLink }, 'crawl practice link');

        await new Promise((resolve) => setTimeout(resolve, 2000));
        const detailReading = await this.parseDetailReadingTest({
          url: practiceLink,
          sessionId,
        });

        // Save reading test to database
        for (const idx in detailReading) {
          const reading = detailReading[idx];
          const partId = listPartIds[idx];
          this.logger.info('Save reading test to database');
          await this.saveReadingTestToDatabase({
            ...reading,
            questionGroups: reading.questions,
            title: reading.title,
            readingId,
            partId,
            originalLink: practiceLink,
            info: result.info,
          });
        }

        const questions = detailReading.flatMap((item) =>
          item.questions.flatMap((item) => item.questions),
        );

        this.logger.info(
          { totalQuestion: questions.length },
          'crawl questions',
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      page++;
    }
  }

  async saveReadingTestToDatabase(data: {
    title: string;
    readingId: string;
    partId: string;
    leftColumnHtml: string;
    rightColumnHtml: string;
    questionGroups: QuestionGroup[];
    originalLink: string;
    info: { duration: string; attempts: string; comments: string };
  }) {
    const readingTest = new ReadingEntity();
    readingTest.title = data.title;
    readingTest.crawlId = data.readingId;
    readingTest.originalLink = data.originalLink;
    readingTest.leftColumnHtml = data.leftColumnHtml;
    readingTest.rightColumnHtml = data.rightColumnHtml;
    readingTest.info = data.info;

    const runner =
      this.readingTestRepository.manager.connection.createQueryRunner();
    await runner.startTransaction();

    try {
      const readingTestEntity = this.readingTestRepository.create(readingTest);
      let reading = await runner.manager.findOne(ReadingEntity, {
        where: {
          crawlId: data.readingId,
        },
      });
      if (!reading) {
        reading = await runner.manager.save(ReadingEntity, {
          ...readingTestEntity,
        });
      }

      // Save question groups and questions
      let questionGroupEntities: QuestionGroupEntity[] =
        this.questionGroupRepository.create(
          data.questionGroups.map((group) => ({
            context: group.context,
            readingId: reading.id,
            totalQuestions: group.totalQuestions,
            crawlPartId: data.partId,
          })),
        );

      questionGroupEntities = await runner.manager.save(
        QuestionGroupEntity,
        questionGroupEntities,
      );

      const saveQuestionPromises: Promise<InsertResult>[] = [];

      for (const idx in questionGroupEntities) {
        const group = questionGroupEntities[idx];
        const questions = data.questionGroups[idx].questions;
        if (!questions) {
          this.logger.warn({ group }, 'No questions found for group');
          continue;
        }

        const questionEntities: QuestionEntity[] =
          this.questionRepository.create(
            questions.map((question) => ({
              questionGroupId: group.id,
              crawlId: group.crawlPartId,
              number: question.number,
              type: question.type,
              text: question.text,
              options: question.options,
              answer: question.answer,
            })),
          );

        saveQuestionPromises.push(
          runner.manager.insert(QuestionEntity, questionEntities),
        );
      }

      await Promise.all(saveQuestionPromises);
      await runner.commitTransaction();
    } catch (error) {
      this.logger.info(
        { err: error },
        'Error saving reading test to database:',
      );
      await runner.rollbackTransaction();
      throw new InternalServerErrorException();
    } finally {
      await runner.release();
    }
  }

  async getUrl(url: string) {
    const response = await axios.get(url);
    return response.data;
  }

  async parseListReadingTest(
    url: string,
    params: {
      sessionId: string;
      csrfToken: string;
    },
  ): Promise<ReadingTestDto[]> {
    try {
      // Fetch HTML content using axios

      const headers = {
        Cookie:
          'sessionid=' + params.sessionId + '; csrftoken=' + params.csrfToken,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        cf_clearance:
          't9aMCXiaBpuY058aJ6LX30lsujAkOcpCTpu9BRYTTgA-1737993386-1.2.1.1-LbZc11uocGTX4mLPZwQr076xgH.w19sNrCdDN2F46xTU2DGzoqaoVz8pfyMNCzyKGDuaxuvatlL2.wMQ07pfPF13cX4TMJDG9xy2SS84hYylffFWhpA_GsdQLm82srP.MuCqpocgPir3yFrQM2kSSvxRurDDSmNpigwouf.0JbP8w76QGQ1KCG2xt1phcMM_wlwDy96VTW2.9d439qRoZal0YUyHcEgGpvlWd1x3VD.ONfYNcXR7Z5mAMSEC7dnuusDyjYPmscGdszpK_O56QAyWyPnF.qqgsG5YUILcD7y_wkJdA_NhXHiT_82xh97ryH.bkwlt8tafHlITJj9hZg',
      };

      const response = await axios.get(url, {
        headers: headers,
      });
      const fileContent = response.data;

      // Load content with Cheerio
      const $ = cheerio.load(fileContent);
      // Extract data
      const results: ReadingTestDto[] = [];
      $('.testitem-wrapper').each((_, element) => {
        let link = $(element).find('a.text-dark').attr('href') || '';
        link = this.baseUrl + link;
        const title = $(element).find('h2.testitem-title').text().trim();

        const duration = $(element)
          .find('.testitem-info .far.fa-clock.mr-1')
          .parent()
          .text()
          .split('|')[0]
          ?.trim();
        const attempts = $(element)
          .find('.testitem-info .far.fa-user-edit.mr-1')
          .parent()
          .text()
          .split('|')[1]
          ?.trim();
        const comments = $(element)
          .find('.testitem-info .far.fa-comments.mr-1')
          .parent()
          .text()
          .split('|')[2]
          ?.trim();
        results.push({ link, title, info: { duration, attempts, comments } });
      });
      return results;
    } catch (error) {
      this.logger.error({ err: error }, 'Error fetching or parsing the URL');
      throw new ReadingParseError(error);
    }
  }

  // async parsingDetailReadingFromFile(filePath: string) {
  async parsingDetailReadingFromFile(fileContent: string |Buffer): Promise<
    {
      title: string;
      leftColumnHtml: string;
      rightColumnHtml: string;
      questions: QuestionGroup[];
    }[]
  > {
    // const fileContent = fs.readFileSync(filePath, 'utf-8');
    const $ = cheerio.load(fileContent);

    /* // Define the output structure
    const results: {
      // headings: { tag: string; text: string }[];
      title: string;
      content: string;
      questions: { instruction: string; details: any }[];
      awnsers: string[][];
    }[] = []; */
    // Array to store parsed data
    const parsedData: {
      title: string;
      leftColumnHtml: string;
      rightColumnHtml: string;
      questions: QuestionGroup[];
    }[] = [];

    // Select all elements with the desired class
    $('.question-twocols').each((_, element) => {
      const section = $(element);

      // Parse the left column (content)
      const leftColumn = section.find('.question-twocols-left');
      const title = leftColumn.find('p').first().text().trim();
      const leftColumnHtml = leftColumn.html().replace(/^\s+|\s+$/gm, '') || '';

      // console.log('leftColumnHtml =>', leftColumnHtml);
      /* const contentParagraphs = leftColumn
        .find('p')
        .slice(1)
        .map((_, p) => $(p).text().trim())
        .get();
*/
      // const content = contentParagraphs.join('\n');

      // Parse the right column (questions)
      const rightColumn = section.find('.question-twocols-right');
      const rightColumnHtml =
        rightColumn
          .html()
          ?.trim()
          ?.replace(/^\s+|\s+$/gm, '') || '';
      // console.log('rightColumnHtml =>', rightColumnHtml);
      /* const instruction = rightColumn.find('p').first().text().trim();
      const questions = rightColumn
        .find('.question-wrapper .question-text')
        .map((_, q) => $(q).text().trim())
        .get();
*/

      // Find question groups within this specific section
      const questionGroups: QuestionGroup[] = [];
      rightColumn.find('.question-group-wrapper').each((_, groupElement) => {
        const group: QuestionGroup = {
          questions: [],
          totalQuestions: 0,
        };

        // Extract context if exists
        const contextElement = $(groupElement).find('.context-content');
        if (contextElement.length) {
          group.context = contextElement.text().trim();
        }

        // Find all questions in this group
        $(groupElement)
          .find('.question-wrapper')
          .each((_, questionElement) => {
            const $question = $(questionElement);
            const questionId = $question.data('qid')?.toString() || '';
            const numberElement = $question.find('.question-number strong');
            const number = parseInt(numberElement.text().trim());
            const textElement = $question.find('.question-text');
            const text = textElement.text().trim();

            // Determine question type based on input element
            const inputElement = $question.find('input');
            const type =
              inputElement.attr('type') === 'radio' ? 'radio' : 'text';

            const question: Question = {
              id: questionId,
              number,
              type,
              text,
            };

            // Handle radio options if present
            if (type === 'radio') {
              const options: RadioOption[] = [];
              $question.find('.radio-option').each((_, optionElement) => {
                const $option = $(optionElement);
                options.push({
                  value: $option.find('input').val()?.toString() || '',
                  label: $option.find('label').text().trim(),
                });
              });
              question.options = options;
            }

            group.totalQuestions = group.questions.length;

            group.questions.push(question);
          });

        group.totalQuestions = group.questions.length;
        console.log(group.totalQuestions);

        questionGroups.push(group);
      });
      // Add parsed data to the array

      parsedData.push({
        title,
        leftColumnHtml,
        rightColumnHtml,
        questions: questionGroups,
      });
    });

    const questions = parsedData.map((data) => data.questions).flat();
    console.log(`questions =>`, JSON.stringify(questions));

    // console.log(parsedData);
    return parsedData;
  }

  async parseReadingTestWithParts(params: {
    linkTest: string;
    sessionId: string;
  }): Promise<{ partId: string; solutionLink: string }[]> {
    if (!params.sessionId || params.sessionId === '') {
      throw new Error('Session id is required');
    }

    const headers = {
      Cookie: 'sessionid=' + params.sessionId,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };
    const response = await axios.get(params.linkTest, {
      headers: headers,
    });

    const fileContent = response.data;
    const $ = cheerio.load(fileContent);

    const parts: { partId: string; solutionLink: string }[] = [];

    $('#test-solutions ul li').each((_, element) => {
      const $element = $(element);
      const solutionLink = $element.find('a').attr('href');
      const partText = $element.find('span').first().text().trim();

      // Extract part ID from solution link
      const partIdMatch = solutionLink?.match(/parts\/(\d+)\//);
      const partId = partIdMatch ? partIdMatch[1] : '';

      if (solutionLink && partId) {
        parts.push({ partId, solutionLink });
      }
    });

    return parts;
  }

  async parseDetailReadingTest(params: {
    url: string;
    sessionId: string;
  }): Promise<
    {
      title: string;
      leftColumnHtml: string;
      rightColumnHtml: string;
      questions: QuestionGroup[];
    }[]
  > {
    // Require login by gg => need change session id in cookie
    // Đọc file HTML
    // const html = fs.readFileSync('path/to/detail_reading.txt', 'utf-8');

    // Tải HTML vào Cheerio
    // Fetch HTML content using axios
    if (!params.sessionId || params.sessionId === '') {
      throw new Error('Session id is required');
    }

    const headers = {
      Cookie: 'sessionid=' + params.sessionId,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };
    const response = await axios.get(params.url, {
      headers: headers,
    });

    return await this.parsingDetailReadingFromFile(response.data);
  }

  async crawlAudioTest(_sessionId: string, _csrfToken: string) {
    let page = 1;
    const sessionId = _sessionId || 'nxz0jqtvofig5m0rv0tc26q2qftakuc6';
    const csrfToken =
      _csrfToken ||
      '33Itcf79rUSXy6lC4RpYyTQtC3ESgEwfaSDnaFwC9IJMUTMLKQkIoraakqVpvQ1u';
    this.logger.info({ sessionId }, 'crawl reading test');
  }
}














@Injectable()
  export class ListeningService {
    private readonly logger = new Logger(ListeningService.name);
  
    constructor(
      @InjectRepository(ListeningEntity)
      private listeningTestRepository: Repository<ListeningEntity>,
  
      @InjectRepository(ListeningQuestionGroupEntity)
      private questionGroupRepository: Repository<ListeningQuestionGroupEntity>,
  
      @InjectRepository(ListeningQuestionEntity)
      private questionRepository: Repository<ListeningQuestionEntity>,
  
      private readonly dataSource: DataSource, // Dùng DataSource để quản lý transaction
    ) {}

  }


class ListeningCrawler {
  private baseUrl = 'https://study4.com';
  private readonly logger = new Logger(ListeningCrawler.name);
  dataSource: any;
  
  constructor() {
    console.log('✅ ListeningCrawler instance created!');
  }
  
  async crawlListeningTest(_sessionId: string, _csrfToken: string) {
    let page = 1;
    const sessionId = _sessionId || 'nxz0jqtvofig5m0rv0tc26q2qftakuc6';
    const csrfToken =
      _csrfToken ||
      '33Itcf79rUSXy6lC4RpYyTQtC3ESgEwfaSDnaFwC9IJMUTMLKQkIoraakqVpvQ1u';
  
    this.logger.log({ sessionId }, 'Crawling listening tests');
  
    while (true) {
      const listListening = await this.parseListListeningTest(`https://study4.com/tests/ielts/?term=listening&page=${page}`, sessionId, csrfToken);

  
      if (listListening.length === 0) {
        this.logger.log('End crawl listening. No more pages');
        break;
      }
      let questions: any[] = [];
      interface QuestionGroup {
        title: string;
        questions: Question[];
      }
      for (const result of listListening) {
        const linkTest = result.link;
        const splitLink = linkTest.split('/');
        const sliceArr = splitLink.slice(0, splitLink.length - 2);
        const listeningId = sliceArr[sliceArr.length - 1];
        const linkWithId = sliceArr.join('/');
        const parts = await this.parseListListeningTest(
          `https://study4.com/tests/ielts/?term=listening&page=${page}`,
          sessionId,    // Truyền sessionId bình thường
          csrfToken     // Truyền csrfToken bình thường
        );
        
  
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const listPartIds = parts.map((item) => String(item.partId ?? 'defaultId'));
        const practiceLink = `${linkWithId}/practice/?part=${
          listPartIds[0]
        }&part=${listPartIds.slice(1, listPartIds.length).join('&part=')}`;
        this.logger.log({ practiceLink }, 'Crawl practice link');
  
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const detailListening = await this.parseDetailListeningTest(practiceLink, sessionId);
        
        interface questionGroups {
          title: string;
          questions: Question[];
        }
        
        interface Listening {
          title: string;
          questions: Question[];  // Mảng câu hỏi
        }
        
        // Save listening test to database
        for (const idx in detailListening) {
          const listening = detailListening[idx];
          const partId = listPartIds[idx];
          this.logger.log('Save listening test to database');
          
          await this.saveListeningTestToDatabase({
            ...listening,
            questionGroups: (listening.questions ?? []).map(q => ({
              title: q.text ?? "Unnamed Group",  // Truy cập vào `text` của `q` thay vì `questions`
              questions: [{  // Truy cập trực tiếp vào các thuộc tính `number`, `text`, và `answer` của `q`
                number: q.number,
                text: q.text,
                answer: q.answer
              }]
            })),
            title: listening.title || "Default Title",  // Truy cập vào `title` của `listening`
            listeningId,
            partId,
            originalLink: practiceLink,
            info: {
              duration: result.info?.duration ?? "N/A",
              attempts: result.info?.attempts ?? "0",
              comments: result.info?.comments ?? "No comments"
            },
            audioLinks: []  // Mảng audioLinks
          });
        }
        
        
        
        
        questions = detailListening.flatMap((item) =>
          item.questions ? item.questions.flatMap((q) => q.questions ?? []) : []
        );
        
        
        
      
        this.logger.log(
          { totalQuestion: questions.length },
          'Crawl questions',
        );
      }
    
      await new Promise((resolve) => setTimeout(resolve, 3000));
      page++;
    }
  }
  async getUrl(url: string) {
    const response = await axios.get(url);
    return response.data;
  }
  async parseListListeningTest(page: string, sessionId: string, csrfToken: string) {
    try {
      const url = `${this.baseUrl}/tests/ielts/?term=listening&page=${page}`;
      const headers = {
        Cookie: `sessionid=${sessionId}; csrftoken=${csrfToken}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      };
  
      const response = await axios.get(url, { headers });
      console.log('🔍 HTML Response:', response.data); // In HTML ra console
  
      const $ = cheerio.load(response.data);
  
      return $('.testitem-wrapper')
        .map((_, el) => {
          const link = this.baseUrl + ($(el).find('a.text-dark').attr('href') || '');
          return {
            link,
            title: $(el).find('h2.testitem-title').text().trim(),
            info: {
              duration: $(el).find('.far.fa-clock.mr-1').parent().text().split('|')[0]?.trim(),
              attempts: $(el).find('.far.fa-user-edit.mr-1').parent().text().split('|')[1]?.trim(),
              comments: $(el).find('.far.fa-comments.mr-1').parent().text().split('|')[2]?.trim(),
            },
          };
        })
        .get();
    } catch (error) {
      this.logger.error({ error }, 'Error parsing listening test list');
      return [];
    }
  }
  
  

  async processListeningTest(test: any, sessionId: string) {
    const linkParts = test.link.split('/');
    const listeningId = linkParts.at(-3);
    const baseLink = linkParts.slice(0, -2).join('/');
  
    const parts = await this.parseListeningTestWithParts(test.link, sessionId);
    if (!parts.length) return;
  
    const practiceLink = `${baseLink}/practice/?part=${parts.map(p => p.partId).join('&part=')}`;
    this.logger.log({ practiceLink }, 'Crawling practice link');
    
    const detailListening = await this.parseDetailListeningTest(practiceLink, sessionId);
    const testTitle = await this.extractTitleFromPage(practiceLink, sessionId);
    
    for (const [index, listening] of detailListening.entries()) {
      const partId = parts[index]?.partId;
      const audioLinks = await this.extractAudioLinks(listening.htmlContent);
  
      this.logger.log('Saving listening test to database');
      await this.saveListeningTestToDatabase({
        ...listening,
        questionGroups: [{ 
          title: `Part ${index + 1}`,
          questions: (detailListening[index]?.questions || []).map(q => ({
            number: Number(q.number) || 0,
            text: q.text || '',
            answer: q.answer || '',
          })),
        }],
        title: testTitle || 'Untitled',
        listeningId,
        partId,
        originalLink: practiceLink,
        info: test.info,
        audioLinks,
      });
  
      const filePath = path.resolve(__dirname, 'listening.txt');
      console.log('Saving listening data to:', filePath);
      console.log('HTML Content:', listening.htmlContent); // Log HTML content
      fs.appendFileSync(filePath, listening.htmlContent + '\n\n');
      console.log('Data appended to file.'); // Log success
    }
  }

  async parseListeningTestWithParts(params: {
  linkTest: string;
  sessionId: string;
  csrfToken: string;
}, sessionId: string) {
    if (!params.sessionId || params.sessionId === '') {
      throw new Error('Session id is required');
    }
  
    const headers = {
      Cookie: `sessionid=${params.sessionId}; csrftoken=${params.csrfToken}`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };
  
    try {
      const response = await axios.get(params.linkTest, { headers });
      const $ = cheerio.load(response.data);
  
      return $('.part-list .part-item')
        .map((_, el) => ({
          partId: $(el).attr('data-id'),
        }))
        .get();
    } catch (error) {
      this.logger.error({ error }, 'Error parsing listening test parts');
      return [];
    }
  }
  

  async parseDetailListeningTest(url: string, sessionId: string) {
    try {
      const headers = this.getDynamicHeaders(sessionId);
      const response = await axios.get(url, { headers });
      const $ = cheerio.load(response.data);
  
      return $('.question-group').map((_, el) => {
        const questions = $(el).find('.question').map((__, q) => ({
          number: $(q).find('.question-number').text().trim(),
          text: $(q).find('.question-text').text().trim(),
          answer: $(q).find('.question-answer').text().trim(),
        })).get();
        
        return { 
          questions,  // 🛠️ Kiểm tra xem `questions` có tồn tại không
          htmlContent: $.html(el) 
        };
      }).get();
    } catch (error) {
      this.logger.error({ error }, 'Error parsing listening test details');
      return [];
    }
  }
  
  /**
   * Hàm tạo headers động, hỗ trợ cookie và User-Agent
   */
  private getDynamicHeaders(sessionId: string) {
    return {
      Cookie: `sessionid=${sessionId}`,
      'User-Agent': this.getRandomUserAgent(), // Dùng User-Agent ngẫu nhiên
    };
  }
  
  /**
   * Trả về một User-Agent ngẫu nhiên để tránh bị chặn
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }
  


  async extractTitleFromPage(url: string, sessionId: string): Promise<string> {
    try {
      const headers = { Cookie: `sessionid=${sessionId}` };
      const response = await axios.get(url, { headers });
      const $ = cheerio.load(response.data);
      return $('h1.test-title').text().trim() || 'Unknown Title';
    } catch (error) {
      this.logger.error({ error }, 'Error extracting title from page');
      return 'Unknown Title';
    }
  }

  async extractAudioLinks(htmlContent: string): Promise<string[]> {
    const $ = cheerio.load(htmlContent);
    return $('audio source').map((_, el) => $(el).attr('src') || '').get();
  }

  
  
  
    async saveListeningTestToDatabase(data: {
      title: string;
      listeningId: string;
      partId: string;
      questionGroups: {
        title: string;
        questions: { number: number; text: string; answer: string }[];
      }[];
      originalLink: string;
      info: { duration: string; attempts: string; comments: string };
      audioLinks: string[];
    }) 
    
    
    {
    
  
    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
  
    try {
      let listening: ListeningEntity | null = await queryRunner.manager.findOne(ListeningEntity, {
        where: { crawlId: data.listeningId },
      });
  
      if (!listening) {
        listening = new ListeningEntity();
      }
  
      listening.title = data.title ?? 'Unknown';
      listening.crawlId = data.listeningId ?? '';
      listening.originalLink = data.originalLink ?? '';
      listening.info = data.info ?? { duration: '', attempts: '', comments: '' };
      listening.audioLinks = data.audioLinks ?? [];
  
      listening = await queryRunner.manager.save(ListeningEntity, listening);
      
      let questionGroupEntities: ListeningQuestionGroupEntity[] = data.questionGroups.map((group) => {
        const questionGroup = new ListeningQuestionGroupEntity();
        questionGroup.title = group.title;
        questionGroup.listeningTest = listening;
        return questionGroup;
      });
  
      questionGroupEntities = await queryRunner.manager.save(ListeningQuestionGroupEntity, questionGroupEntities);
  
      for (const [index, group] of questionGroupEntities.entries()) {
        const questions = data.questionGroups[index]?.questions;
        if (!questions || questions.length === 0) {
          this.logger.warn(`Không tìm thấy câu hỏi cho nhóm ${group.id}`);
          continue;
        }
  
        const questionEntities: ListeningQuestionEntity[] = questions.map((question) => {
          const q = new ListeningQuestionEntity();
          q.group = group;
          q.number = question.number;
          q.text = question.text;
          q.answer = question.answer;
          return q;
        });
        console.log('📝 Danh sách câu hỏi chuẩn bị lưu:', questionEntities);
        await queryRunner.manager.save(ListeningQuestionEntity, questionEntities);
      }
  
      await queryRunner.commitTransaction();
    } catch (error) {
      this.logger.error('Lỗi khi lưu bài test Listening', error);
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Không thể lưu bài test Listening');
    } finally {
      await queryRunner.release();
    }
  }
  
  

}

  console.log("Study4 Service is running...");
  (async () => {
    console.log('🛠️ Bắt đầu chạy ListeningCrawler...');
  
    const sessionId = 'fake-session-id';
    const csrfToken = 'fake-csrf-token';
    
    const crawler = new ListeningCrawler();
    console.log('✅ ListeningCrawler đã được khởi tạo!');
  
    try {
      await crawler.crawlListeningTest(sessionId, csrfToken);
      console.log('🎯 Hoàn thành crawl dữ liệu!');
  
    } catch (err) {
      console.error('❌ Lỗi trong quá trình crawl hoặc lưu dữ liệu:', err);
    }
  })();

  
  


  