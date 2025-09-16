import { TestBed } from '@angular/core/testing';

import { Detection } from './detection';

describe('Detection', () => {
  let service: Detection;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Detection);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
