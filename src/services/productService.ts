import { db } from '../db/client';
import * as productRepository from '../repositories/productRepository';
import type { Product } from '../schemas/product';

/**
 * Retrieves all products.
 *
 * @returns A Promise resolving to an array of Product objects.
 */
export async function getAllProductsService(): Promise<Product[]> {
    return productRepository.getAllProducts(db);
}