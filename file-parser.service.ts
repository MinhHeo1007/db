import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

interface ParsedItem {
  link: string;
  title: string;
  info: string;
}

@Injectable()
export class FileParserService {
  async parseFromUrl(url: string): Promise<ParsedItem[]> {
    try {
      // Fetch HTML content using axios
      const response = await axios.get(url);
      const fileContent = response.data;

      // Load content with Cheerio
      const $ = cheerio.load(fileContent);
      // Extract data
      const results: ParsedItem[] = [];
      $('.testitem-wrapper').each((_, element) => {
        const link = $(element).find('a.text-dark').attr('href') || '';
        const title = $(element).find('h2.testitem-title').text().trim();
        const info = $(element)
          .find('.testitem-info')
          .map((_, infoElement) => $(infoElement).text().trim())
          .get()
          .join(' | ');
        results.push({ link, title, info });
      });
      /* // Extract data
      const results: ParsedItem[] = [];
      $('a[href^="/test/"]').each((_, element) => {
        const link = $(element).attr('href') || '';
        const title =
          $(element).find('h2').text().trim() ||
          $(element).siblings('h2').text().trim();
        const info = $(element)
          .closest('.testitem-wrapper')
          .find('.testitem-info')
          .text()
          .trim();
        results.push({ link, title, info });
      }); */

      return results;
    } catch (error) {
      console.error('Error fetching or parsing the URL:', error);
      throw new Error('Failed to parse content from the URL');
    }
  }
}
